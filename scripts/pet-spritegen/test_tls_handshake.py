import http.client
import json
import ssl
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import cli_runner
from http_diagnostics import HttpDiagnostics


class FakeSocket:
    def __init__(self, error=None):
        self.error = error
        self.sent = []

    def sendall(self, data):
        if self.error:
            raise self.error
        self.sent.append(data)


class TlsHandshakeTests(unittest.TestCase):
    def test_real_tls_handshake_eof_records_no_http_bytes(self):
        client, peer = socket.socketpair()
        received = []
        def close_after_client_hello():
            with peer:
                received.append(peer.recv(65536))
        thread = threading.Thread(target=close_after_client_hello)
        thread.start()
        connection = http.client.HTTPSConnection('api.openai.com', timeout=2)
        def connected_socket(connection):
            connection.sock = client
        try:
            with patch.object(http.client.HTTPConnection, 'connect', connected_socket), HttpDiagnostics() as diagnostic:
                with self.assertRaises(ssl.SSLEOFError) as caught:
                    connection.request('POST', '/v1/images/generations', b'private image request')
                cause = cli_runner.classify(caught.exception, unsent_tls_error=diagnostic.unsent_tls_error)
            self.assertEqual(cause, {'kind': 'tls_error', 'errno': 8, 'requestSent': False})
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(received[0][0], 22)  # TLS handshake record.
            self.assertNotIn(b'POST', received[0])
            self.assertNotIn(b'private image request', received[0])
        finally:
            connection.close()
            client.close()
            peer.close()
            thread.join(timeout=3)

    def exercise(self, handshake_error=None, send_error=None, host='api.openai.com', prior_request=False):
        socket = FakeSocket(send_error)

        def handshake(_socket, *args, **kwargs):
            if handshake_error:
                raise handshake_error

        def connect(connection):
            ssl.SSLSocket.do_handshake(object())
            connection.sock = socket

        with patch.object(http.client.HTTPSConnection, 'connect', connect), patch.object(ssl.SSLSocket, 'do_handshake', handshake):
            with HttpDiagnostics() as diagnostic:
                if prior_request:
                    with patch.object(ssl.SSLSocket, 'do_handshake', lambda *_: None):
                        http.client.HTTPSConnection(host).request('POST', '/v1/images/generations', b'earlier')
                try:
                    http.client.HTTPSConnection(host).request('POST', '/v1/images/generations', b'private body')
                except ssl.SSLError as error:
                    proof = getattr(diagnostic, 'unsent_tls_error', None)
                    cause = cli_runner.classify(error, unsent_tls_error=proof) if proof is not None else cli_runner.classify(error)
                else:
                    self.fail('Expected the synthetic transport error')
        return cause, socket

    def test_initial_handshake_eof_is_proven_unsent(self):
        cause, socket = self.exercise(handshake_error=ssl.SSLEOFError(8, 'private details'))
        self.assertEqual(cause, {'kind': 'tls_error', 'errno': 8, 'requestSent': False})
        self.assertEqual(socket.sent, [])

    def test_tls_error_after_connect_is_not_proven_unsent(self):
        cause, _ = self.exercise(send_error=ssl.SSLEOFError(8, 'private details'))
        self.assertEqual(cause, {'kind': 'tls_error', 'errno': 8})

    def test_later_handshake_cannot_erase_an_earlier_request(self):
        cause, socket = self.exercise(handshake_error=ssl.SSLEOFError(8, 'private details'), prior_request=True)
        self.assertTrue(socket.sent)
        self.assertEqual(cause, {'kind': 'tls_error', 'errno': 8})

    def test_unrelated_host_has_no_provider_unsent_proof(self):
        cause, _ = self.exercise(handshake_error=ssl.SSLEOFError(8, 'private details'), host='unrelated.invalid')
        self.assertEqual(cause, {'kind': 'tls_error', 'errno': 8})

    def test_proxy_connect_bytes_do_not_count_as_image_request(self):
        proxy_socket = FakeSocket()
        def handshake(_socket, *args, **kwargs):
            raise ssl.SSLEOFError(8, 'private')
        def connect(connection):
            connection.sock = proxy_socket
            connection.send(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n')
            ssl.SSLSocket.do_handshake(object())
        with patch.object(http.client.HTTPSConnection, 'connect', connect), patch.object(ssl.SSLSocket, 'do_handshake', handshake):
            with HttpDiagnostics() as diagnostic:
                connection = http.client.HTTPSConnection('proxy.invalid')
                connection.set_tunnel('api.openai.com')
                with self.assertRaises(ssl.SSLError) as caught:
                    connection.request('POST', '/v1/images/generations', b'image body')
                cause = cli_runner.classify(caught.exception, unsent_tls_error=diagnostic.unsent_tls_error)
        self.assertEqual(cause['requestSent'], False)
        self.assertEqual(proxy_socket.sent, [b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n'])

    def test_renderer_consumes_proof_and_missing_diagnostic_stays_unknown(self):
        import subprocess
        import renderer
        for preserve in [True, False]:
            with self.subTest(preserve=preserve), tempfile.TemporaryDirectory() as folder:
                def failed_process(argv, **kwargs):
                    if preserve:
                        Path(argv[2]).write_text(json.dumps({'cause': {'kind': 'tls_error', 'errno': 8, 'requestSent': False}}))
                    return subprocess.CompletedProcess(argv, 1, '', 'private failure text')
                with patch.object(renderer.subprocess, 'run', side_effect=failed_process):
                    with self.assertRaises(renderer.RenderError) as caught:
                        renderer.run_tool(Path(folder), ['gen'])
                self.assertEqual(str(caught.exception), 'provider_not_sent' if preserve else 'outcome_unknown')

    def test_cli_persists_only_the_safe_handshake_proof(self):
        def handshake(_socket, *args, **kwargs):
            raise ssl.SSLEOFError(8, 'private certificate path and prompt')

        def connect(connection):
            ssl.SSLSocket.do_handshake(object())

        def run(*args, **kwargs):
            http.client.HTTPSConnection('api.openai.com').request('POST', '/v1/images/generations', b'private')

        originals = (http.client.HTTPConnection.send, http.client.HTTPSConnection.connect, ssl.SSLSocket.do_handshake)
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'diagnostic.json'
            with patch.object(http.client.HTTPSConnection, 'connect', connect), patch.object(ssl.SSLSocket, 'do_handshake', handshake), patch.object(cli_runner.runpy, 'run_module', run), patch.object(sys, 'argv', ['wrapper', str(target), 'gen']):
                with self.assertRaises(ssl.SSLError):
                    cli_runner.main()
            value = json.loads(target.read_text())
            self.assertEqual(value['cause'], {'kind': 'tls_error', 'errno': 8, 'requestSent': False})
            self.assertNotIn('private certificate', target.read_text())
        self.assertEqual(originals, (http.client.HTTPConnection.send, http.client.HTTPSConnection.connect, ssl.SSLSocket.do_handshake))


if __name__ == '__main__':
    unittest.main()
