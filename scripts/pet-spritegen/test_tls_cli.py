"""Exercise the pinned CLI exception chain using local TLS failures only."""
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import renderer


NETWORK_GUARD = '''import os,socket
port=int(os.environ['TEST_PROXY_PORT'])
connect=socket.socket.connect
getaddrinfo=socket.getaddrinfo
def local_connect(self,address):
    if not isinstance(address,tuple) or address[0]!='127.0.0.1' or address[1]!=port:
        raise OSError('offline test forbids external connection')
    with open(os.environ['TEST_NETWORK_LOG'],'a') as log:log.write('connect\\n')
    return connect(self,address)
def local_resolve(host,service,*args,**kwargs):
    if host!='127.0.0.1' or int(service)!=port:
        raise OSError('offline test forbids external resolution')
    return getaddrinfo(host,service,*args,**kwargs)
socket.socket.connect=local_connect
socket.getaddrinfo=local_resolve
'''


class RealCliTlsTests(unittest.TestCase):
    def exercise(self, certificate):
        with tempfile.TemporaryDirectory(prefix='sprite-cli-tls-') as folder:
            root = Path(folder)
            guard = root / 'guard'; guard.mkdir()
            (guard / 'sitecustomize.py').write_text(NETWORK_GUARD)
            server_context = None
            if certificate:
                cert, key = root / 'cert.pem', root / 'key.pem'
                subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                                '-keyout', str(key), '-out', str(cert), '-days', '1',
                                '-subj', '/CN=synthetic.invalid'], check=True, timeout=10,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                server_context.load_cert_chain(cert, key)
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0)); listener.listen(1); listener.settimeout(5)
                port = listener.getsockname()[1]
                network_log = root / 'network.log'
                env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(root),
                       'XDG_CONFIG_HOME': str(root / 'config'), 'PYTHONPATH': str(guard),
                       'OPENAI_API_KEY': 'sk-offline-test-only', 'TEST_PROXY_PORT': str(port),
                       'TEST_NETWORK_LOG': str(network_log), 'HTTP_PROXY': f'http://127.0.0.1:{port}',
                       'HTTPS_PROXY': f'http://127.0.0.1:{port}', 'NO_PROXY': ''}
                # Fail before running the CLI if its isolated interpreter cannot load the guard.
                subprocess.run([sys.executable, '-c',
                                "import socket\ntry: socket.getaddrinfo('api.openai.com',443)\n"
                                "except OSError as error: assert 'offline test' in str(error)\n"
                                "else: raise AssertionError('network guard not loaded')"],
                               env=env, check=True, timeout=5, capture_output=True)
                observations, errors = {}, []

                def serve():
                    try:
                        peer, _ = listener.accept()
                        with peer:
                            peer.settimeout(3)
                            header = b''
                            while b'\r\n\r\n' not in header:
                                chunk = peer.recv(4096)
                                if not chunk or len(header) > 4096:
                                    raise AssertionError('incomplete CONNECT')
                                header += chunk
                            observations['connect'] = header.split(b'\r\n', 1)[0]
                            peer.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                            if server_context:
                                try:
                                    with server_context.wrap_socket(peer, server_side=True) as secured:
                                        observations['http_body'] = secured.recv(65536)
                                except ssl.SSLError:
                                    observations['certificate_rejected'] = True
                            else:
                                observations['client_hello'] = peer.recv(65536)
                    except BaseException as error:
                        errors.append(error)

                thread = threading.Thread(target=serve)
                thread.start()
                try:
                    with patch.dict(os.environ, env, clear=True), self.assertRaises(renderer.RenderError) as caught:
                        renderer.run_tool(root, ['gen', '--provider', 'openai', '--model', renderer.MODEL,
                                                '--prompt', 'offline-sentinel-prompt', '--out', str(root / 'image.png'),
                                                '--quality', 'high', '--aspect-ratio', '1:1', '--facing-fix', 'none'])
                finally:
                    thread.join(timeout=6)
                self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])
                method, target, version = observations['connect'].split()
                self.assertEqual((method, target), (b'CONNECT', b'api.openai.com:443'))
                self.assertIn(version, (b'HTTP/1.0', b'HTTP/1.1'))
                self.assertEqual(network_log.read_text().splitlines(), ['connect'])
                self.assertEqual(str(caught.exception), 'provider_not_sent')
                self.assertEqual(caught.exception.cli_cause,
                                 {'kind': 'tls_error', 'errno': 1 if certificate else 8, 'requestSent': False})
                self.assertEqual(caught.exception.failure_diagnostic['boundary'], 'provider_cli')
                frames = [frame['file'] for item in caught.exception.error_details['chain'] for frame in item['frames']]
                self.assertIn('openai_provider.py', frames)
                self.assertFalse((root / 'image.png').exists())
                self.assertEqual(list(root.glob('cli-cause-*')), [])
                if certificate:
                    self.assertTrue(observations['certificate_rejected'])
                    self.assertNotIn('http_body', observations)
                else:
                    hello = observations['client_hello']
                    self.assertEqual(hello[0], 22)
                    self.assertNotIn(b'POST ', hello)
                    self.assertNotIn(b'offline-sentinel-prompt', hello)

    def test_real_cli_preserves_initial_tls_eof_proof(self):
        self.exercise(certificate=False)

    def test_real_cli_preserves_certificate_failure_proof(self):
        self.exercise(certificate=True)


if __name__ == '__main__':
    unittest.main()
