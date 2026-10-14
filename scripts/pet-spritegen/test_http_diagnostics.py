import http.client
import io
import json
import unittest
from urllib.error import HTTPError
from http_diagnostics import HttpDiagnostics, read_http_diagnostic

REQUEST_ID='req_'+'a'*32
CF_RAY='1234567890abcdef-AMS'
class Socket:
    def __init__(self, value): self.value=value
    def makefile(self,*args): return io.BytesIO(self.value)
def response(body=b'abc',status=200,length=3,extra=b'',method='POST'):
    header=(b'Content-Length: '+str(length).encode()+b'\r\n') if length is not None else b''
    raw=b'HTTP/1.1 '+str(status).encode()+b' status\r\n'+header+extra+b'\r\n'+body
    return http.client.HTTPResponse(Socket(raw),method=method)
class HttpDiagnosticTests(unittest.TestCase):
    def test_complete_response_keeps_only_allowlisted_metadata(self):
        with HttpDiagnostics() as diagnostic:
            r=response(extra=f'X-Request-ID: {REQUEST_ID}\r\nCF-Ray: {CF_RAY}\r\nAuthorization: Bearer secret\r\nSet-Cookie: private\r\n'.encode());r.begin();self.assertEqual(r.read(),b'abc')
        self.assertEqual(diagnostic.snapshot(),{'status':200,'expectedBodyBytes':3,'receivedBodyBytes':3,'receivedBodyBytesExact':True,'bodyComplete':True,'chunked':False,'phase':'complete','requestId':REQUEST_ID,'cfRay':CF_RAY})
        self.assertNotRegex(json.dumps(diagnostic.snapshot()),r'Bearer|secret|private')
    def test_complete_520_retains_error_status_and_length(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'private error body',520,18);r.begin();e=HTTPError('https://api.openai.com/v1/images/edits',520,'private',r.headers,r);self.assertEqual(e.read(),b'private error body');e.close()
        self.assertEqual(diagnostic.snapshot()['status'],520);self.assertEqual(diagnostic.snapshot()['receivedBodyBytes'],18);self.assertTrue(diagnostic.snapshot()['bodyComplete'])
    def test_incomplete_200_preserves_status_and_exact_partial_size(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'abc',200,10);r.begin()
            with self.assertRaises(http.client.IncompleteRead) as caught:r.read()
        self.assertEqual(caught.exception.partial,b'abc');self.assertEqual(caught.exception.expected,7)
        self.assertEqual(diagnostic.snapshot(),{'status':200,'expectedBodyBytes':10,'receivedBodyBytes':3,'receivedBodyBytesExact':True,'bodyComplete':False,'chunked':False,'phase':'body','requestId':None,'cfRay':None})
    def test_incomplete_520_body_does_not_lose_original_status(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'abc',520,10);r.begin();e=HTTPError('https://api.openai.com/v1/images/edits',520,'private',r.headers,r)
            with self.assertRaises(http.client.IncompleteRead):e.read()
            e.close()
        self.assertEqual(diagnostic.snapshot()['status'],520);self.assertEqual(diagnostic.snapshot()['receivedBodyBytes'],3)
        self.assertFalse(diagnostic.snapshot()['bodyComplete'])
    def test_no_response_headers_stay_unknown(self):
        with HttpDiagnostics() as diagnostic:
            r=http.client.HTTPResponse(Socket(b''),method='POST')
            with self.assertRaises(http.client.RemoteDisconnected):r.begin()
        self.assertEqual(diagnostic.snapshot()['status'],None);self.assertEqual(diagnostic.snapshot()['phase'],'before_headers');self.assertFalse(diagnostic.snapshot()['receivedBodyBytesExact'])
    def test_chunked_response_has_unknown_expected_size(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'5\r\nhello\r\n0\r\n\r\n',length=None,extra=b'Transfer-Encoding: chunked\r\n');r.begin();self.assertEqual(r.read(),b'hello')
        self.assertEqual(diagnostic.snapshot()['expectedBodyBytes'],None);self.assertEqual(diagnostic.snapshot()['receivedBodyBytes'],5);self.assertTrue(diagnostic.snapshot()['bodyComplete']);self.assertTrue(diagnostic.snapshot()['chunked'])
    def test_partial_chunked_read_is_explicitly_a_lower_bound(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'5\r\nhello\r\n4\r\nwo',length=None,extra=b'Transfer-Encoding: chunked\r\n');r.begin()
            with self.assertRaises(http.client.IncompleteRead) as caught:r.read()
        self.assertEqual(diagnostic.snapshot()['receivedBodyBytes'],len(caught.exception.partial));self.assertFalse(diagnostic.snapshot()['receivedBodyBytesExact']);self.assertFalse(diagnostic.snapshot()['bodyComplete'])
    def test_sequential_reads_accumulate_body_bytes(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'abcdef',length=6);r.begin();self.assertEqual(r.read(amt=2),b'ab');self.assertEqual(r.read(),b'cdef')
        self.assertEqual(diagnostic.snapshot()['receivedBodyBytes'],6);self.assertTrue(diagnostic.snapshot()['bodyComplete'])
    def test_read_error_does_not_claim_an_exact_zero(self):
        class Broken:
            def read(self,*args):raise TimeoutError('secret')
            def close(self):pass
            def flush(self):pass
        with HttpDiagnostics() as diagnostic:
            r=response(length=10);r.begin();r.fp=Broken()
            with self.assertRaises(TimeoutError):r.read()
        self.assertEqual(diagnostic.snapshot()['status'],200);self.assertFalse(diagnostic.snapshot()['receivedBodyBytesExact']);self.assertFalse(diagnostic.snapshot()['bodyComplete'])
    def test_invalid_trace_ids_and_large_length_are_dropped(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'abc',length=99999999999999999999,extra=b'X-Request-ID: Bearer secret\r\nCF-Ray: https://private.example/secret\r\n');r.begin()
        value=diagnostic.snapshot();self.assertIsNone(value['requestId']);self.assertIsNone(value['cfRay']);self.assertIsNone(value['expectedBodyBytes']);self.assertNotIn('secret',json.dumps(value))
    def test_diagnostic_failure_does_not_change_result_and_methods_restore(self):
        begin=http.client.HTTPResponse.begin;read=http.client.HTTPResponse.read
        def broken(_):raise OSError('disk full')
        with HttpDiagnostics(broken) as diagnostic:
            r=response();r.begin();self.assertEqual(r.read(),b'abc')
        self.assertIs(http.client.HTTPResponse.begin,begin);self.assertIs(http.client.HTTPResponse.read,read);self.assertTrue(diagnostic.snapshot()['bodyComplete'])
    def test_connect_response_is_not_an_api_response(self):
        with HttpDiagnostics() as diagnostic:
            r=response(b'',200,0,method='CONNECT');r.begin();r.read()
        self.assertIsNone(diagnostic.snapshot()['status'])
    def test_boundary_reader_drops_unknown_fields_and_rejects_invalid_core(self):
        valid={'status':520,'expectedBodyBytes':3,'receivedBodyBytes':2,'receivedBodyBytesExact':True,'bodyComplete':False,'chunked':False,'phase':'body','requestId':'Bearer secret','cfRay':CF_RAY,'body':'secret','headers':{'Authorization':'Bearer secret'}}
        value=read_http_diagnostic(valid);self.assertIsNotNone(value);self.assertIsNone(value['requestId']);self.assertNotRegex(json.dumps(value),r'Bearer|secret|Authorization')
        for field,value in [('status',True),('receivedBodyBytes',-1),('phase','private'),('bodyComplete',1)]:self.assertIsNone(read_http_diagnostic({**valid,field:value}))
if __name__=='__main__':unittest.main()
