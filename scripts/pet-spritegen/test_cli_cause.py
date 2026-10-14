import importlib.util
import io
from contextlib import redirect_stderr
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).with_name('renderer.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

class CliCauseTests(unittest.TestCase):
    def invoke(self, source, args=('gen',), include_http=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = root / 'sprite_gen'
            package.mkdir()
            (package / '__init__.py').write_text('')
            (package / 'cli.py').write_text("from pathlib import Path\nwith Path('calls').open('a') as stream: stream.write('one\\n')\n" + source)
            stderr=io.StringIO()
            with redirect_stderr(stderr), patch.dict(os.environ, {'PYTHONPATH': str(root), 'OPENAI_API_KEY': 'synthetic-not-a-secret'}):
                try:
                    result = renderer.run_tool(root, list(args))
                except renderer.RenderError as error:
                    result = error
            self.assertEqual((root / 'calls').read_text(), 'one\n')
            self.assertEqual(list(root.glob('cli-cause-*')), [])
            return (result,stderr.getvalue()) if include_http else result

    def test_nested_reset_keeps_only_kind_and_errno_without_replay(self):
        result = self.invoke("from urllib.error import URLError\nraise SystemExit('private prompt and secret') from URLError(ConnectionResetError(104, 'private response'))\n")
        self.assertEqual(str(result), 'outcome_unknown')
        self.assertEqual(getattr(result, 'cli_cause', None), {'kind': 'connection_reset', 'errno': 104})
        self.assertNotIn('private', json.dumps(result.cli_cause))

    def test_invalid_json_keeps_no_document_or_message(self):
        result = self.invoke("import json\nraise SystemExit('openai-gen: response was not valid JSON') from json.JSONDecodeError('private', 'secret document', 0)\n")
        self.assertEqual(getattr(result, 'cli_cause', None), {'kind': 'invalid_json'})

    def test_known_http_rejection_preserves_existing_no_retry_classification(self):
        result = self.invoke("raise SystemExit('openai-gen: image request failed (HTTP 429) code=rate_limit_exceeded; private response')\n")
        self.assertEqual(str(result), 'provider_rate_limited')
        self.assertEqual(result.provider_failure, {'httpStatus': 429, 'code': 'rate_limit_exceeded'})
        self.assertEqual(getattr(result, 'cli_cause', None), {'kind': 'http_error', 'httpStatus': 429})

    def test_success_preserves_arguments_and_output(self):
        args = ('gen', '--prompt-file', 'a file with spaces', '--ref', 'b.png')
        result = self.invoke("import sys,json\nprint(json.dumps({'args':sys.argv[1:]}))\n", args)
        self.assertEqual(json.loads(result), {'args': list(args)})

    def test_unknown_failure_does_not_keep_exception_text(self):
        result = self.invoke("raise RuntimeError('Bearer secret and private prompt')\n")
        self.assertEqual(getattr(result, 'cli_cause', None), {'kind': 'unclassified'})

    def test_transport_variants_keep_only_safe_categories(self):
        cases = [
            ("raise TimeoutError('private')", {'kind':'timeout'}),
            ("import ssl; raise ssl.SSLError(1,'private')", {'kind':'tls_error','errno':1}),
            ("import socket; raise socket.gaierror(-2,'private')", {'kind':'dns_error','errno':-2}),
            ("from http.client import IncompleteRead; raise IncompleteRead(b'private')", {'kind':'incomplete_response'}),
            ("from http.client import RemoteDisconnected; raise RemoteDisconnected('private')", {'kind':'remote_disconnected'}),
            ("raise SystemExit('openai-gen: response has no b64_json image; nothing published')", {'kind':'missing_image'}),
        ]
        for source,expected in cases:
            with self.subTest(kind=expected['kind']):
                self.assertEqual(self.invoke(source).cli_cause, expected)

    def test_provider_image_error_is_not_mislabeled_as_transport_io(self):
        result=self.invoke("raise SystemExit('openai-gen: response image is invalid; nothing published') from OSError('private image')\n")
        self.assertEqual(result.cli_cause,{'kind':'invalid_image'})

    def test_parallel_failures_keep_separate_causes(self):
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);package=root/'sprite_gen';package.mkdir();(package/'__init__.py').write_text('')
            (package/'cli.py').write_text("import sys\nif sys.argv[-1]=='reset': raise ConnectionResetError(104,'private')\nraise TimeoutError('secret')\n")
            def invoke(kind):
                try: renderer.run_tool(root,['gen',kind])
                except renderer.RenderError as error: return error.cli_cause
            with patch.dict(os.environ,{'PYTHONPATH':str(root)}),ThreadPoolExecutor(max_workers=2) as pool:
                self.assertEqual(list(pool.map(invoke,['timeout','reset'])),[{'kind':'timeout'},{'kind':'connection_reset','errno':104}])
            self.assertEqual(list(root.glob('cli-cause-*')),[])

    def test_details_keep_stack_and_standard_message_without_private_exception_text(self):
        result=self.invoke("from http.client import RemoteDisconnected\nraise SystemExit('private prompt Bearer secret') from RemoteDisconnected('custom secret response')\n")
        details=getattr(result,'error_details',None)
        self.assertIsNotNone(details)
        self.assertTrue(any(item['type']=='RemoteDisconnected' for item in details['chain']))
        self.assertTrue(any(item['message']=='Remote end closed connection without response' for item in details['chain']))
        self.assertTrue(any(item['frames'] for item in details['chain']))
        self.assertNotRegex(json.dumps(details), r'private prompt|Bearer|secret|custom|response\)')
        for item in details['chain']:
            self.assertLessEqual(len(item['frames']),8)
            for frame in item['frames']: self.assertNotIn('/',frame['file'])

    def test_http_metadata_crosses_cli_bridge_on_success_and_failure(self):
        for status,body,length in [(200,b'abc',3),(520,b'abc',3),(200,b'abc',10),(520,b'abc',10)]:
            with self.subTest(status=status,length=length):
                raw=b'HTTP/1.1 '+str(status).encode()+b' status\r\nContent-Length: '+str(length).encode()+b'\r\nX-Request-ID: req_'+b'a'*32+b'\r\nCF-Ray: 1234567890abcdef-AMS\r\n\r\n'+body
                source="import io,http.client\nclass Sock:\n def makefile(self,*args):return io.BytesIO("+repr(raw)+")\nr=http.client.HTTPResponse(Sock(),method='POST');r.begin();r.read()\n"
                source+= "raise SystemExit('openai-gen: image request failed (HTTP 520); private secret')\n" if status==520 else "print('ok')\n"
                result,stderr=self.invoke(source,include_http=True)
                logs=[json.loads(line.removeprefix('PET_HTTP_DIAGNOSTIC '))for line in stderr.splitlines()if line.startswith('PET_HTTP_DIAGNOSTIC ')]
                self.assertEqual(len(logs),1);self.assertEqual(logs[0]['status'],status);self.assertEqual(logs[0]['expectedBodyBytes'],length);self.assertEqual(logs[0]['receivedBodyBytes'],3);self.assertEqual(logs[0]['bodyComplete'],length==3);self.assertEqual(logs[0]['requestId'],'req_'+'a'*32)
                self.assertNotRegex(stderr,r'private secret|synthetic-not-a-secret')
                if length==10:self.assertEqual(result.cli_cause,{'kind':'incomplete_response'})
                elif status==520:self.assertEqual(result.cli_cause,{'kind':'http_error','httpStatus':520})
                else:self.assertEqual(result,'ok\n')

    def test_metadata_checkpoints_are_atomic_private_and_optional(self):
        from cli_runner import write_diagnostic
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'diagnostic.json'
            write_diagnostic(path,{'httpDiagnostic':{'phase':'body'}})
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertEqual(json.loads(path.read_text()),{'httpDiagnostic':{'phase':'body'}})
            with patch('cli_runner.os.replace',side_effect=OSError('synthetic full disk')):
                write_diagnostic(path,{'httpDiagnostic':{'phase':'complete'}})
            self.assertEqual(json.loads(path.read_text()),{'httpDiagnostic':{'phase':'body'}})
            self.assertFalse(path.with_name(path.name+'.tmp').exists())

    def test_headers_checkpoint_survives_an_unhandled_cli_exit(self):
        raw=b'HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc'
        source="import io,http.client,os\nclass Sock:\n def makefile(self,*args):return io.BytesIO("+repr(raw)+")\nr=http.client.HTTPResponse(Sock(),method='POST');r.begin();os._exit(7)\n"
        result,stderr=self.invoke(source,include_http=True)
        value=json.loads(next(line.removeprefix('PET_HTTP_DIAGNOSTIC ')for line in stderr.splitlines()if line.startswith('PET_HTTP_DIAGNOSTIC ')))
        self.assertEqual(str(result),'outcome_unknown');self.assertEqual(value['status'],200);self.assertEqual(value['expectedBodyBytes'],10);self.assertFalse(value['receivedBodyBytesExact']);self.assertFalse(value['bodyComplete']);self.assertEqual(value['phase'],'body')

if __name__ == '__main__':
    unittest.main()
