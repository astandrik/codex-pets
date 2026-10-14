"""Run the pinned CLI once, retaining only an allowlisted exception category."""
import http.client
import json
import os
import re
import runpy
import socket
import ssl
import sys
from contextlib import nullcontext
from pathlib import Path
from urllib.error import HTTPError, URLError
from http_diagnostics import HttpDiagnostics


def classify(error):
    chain = []
    while isinstance(error, BaseException) and len(chain) < 8 and all(error is not item for item in chain):
        chain.append(error)
        if isinstance(error, URLError) and isinstance(error.reason, BaseException):
            error = error.reason
        else:
            error = error.__cause__ or error.__context__
    for item in chain:
        if not isinstance(item, SystemExit) or not isinstance(item.code, str): continue
        # Match only pinned CLI prefixes before a private body; never copy text.
        message = item.code
        match = re.match(r"^openai-gen: (?:credential OPENAI_API_KEY rejected|image request failed|refused by the provider's content policy) \(HTTP ([45]\d{2})\)", message)
        if match: return {'kind': 'http_error', 'httpStatus': int(match[1])}
        messages = {
            'openai-gen: response was not valid JSON': 'invalid_json',
            'openai-gen: expected exactly one image in the response; nothing published': 'invalid_response_shape',
            'openai-gen: response has no b64_json image; nothing published': 'missing_image',
            'openai-gen: response image is invalid; nothing published': 'invalid_image',
            'openai-gen: request failed or timed out; no automatic retry (the server may have accepted it)': 'transport_error',
        }
        if message in messages and messages[message] != 'transport_error': return {'kind': messages[message]}
    for item in reversed(chain):
        kind = None
        if isinstance(item, HTTPError):
            return {'kind': 'http_error', 'httpStatus': item.code} if 400 <= item.code <= 599 else {'kind': 'http_error'}
        if isinstance(item, TimeoutError): kind = 'timeout'
        elif isinstance(item, http.client.RemoteDisconnected): kind = 'remote_disconnected'
        elif isinstance(item, ConnectionResetError): kind = 'connection_reset'
        elif isinstance(item, ConnectionRefusedError): kind = 'connection_refused'
        elif isinstance(item, BrokenPipeError): kind = 'broken_pipe'
        elif isinstance(item, ssl.SSLError): kind = 'tls_error'
        elif isinstance(item, socket.gaierror): kind = 'dns_error'
        elif isinstance(item, http.client.IncompleteRead): kind = 'incomplete_response'
        elif isinstance(item, json.JSONDecodeError): kind = 'invalid_json'
        elif isinstance(item, UnicodeError): kind = 'invalid_encoding'
        elif isinstance(item, OSError): kind = 'io_error'
        if kind:
            result = {'kind': kind}
            number = getattr(item, 'errno', None)
            if type(number) is int and -4096 <= number <= 4096: result['errno'] = number
            return result
    if any(isinstance(item, URLError) for item in chain): return {'kind': 'transport_error'}
    return {'kind': 'unclassified'}


def error_details(error):
    types = {
        'SystemExit':'CLI exited; private message omitted',
        'RemoteDisconnected':'Remote end closed connection without response',
        'ConnectionResetError':'Connection reset',
        'ConnectionRefusedError':'Connection refused',
        'BrokenPipeError':'Broken pipe',
        'TimeoutError':'Operation timed out',
        'SSLError':'TLS error; private details omitted',
        'SSLCertVerificationError':'TLS error; private details omitted',
        'gaierror':'DNS resolution failed',
        'IncompleteRead':'Incomplete HTTP response',
        'JSONDecodeError':'Invalid JSON response; document omitted',
        'UnicodeDecodeError':'Invalid response encoding',
        'URLError':'Exception message omitted',
        'HTTPError':'HTTP error; response body omitted',
        'OSError':'I/O error; private details omitted',
    }
    chain=[];seen=[]
    while isinstance(error,BaseException) and len(chain)<4 and all(error is not item for item in seen):
        seen.append(error);name=type(error).__name__;frames=[];trace=error.__traceback__
        while trace:
            file=Path(trace.tb_frame.f_code.co_filename).name
            function=trace.tb_frame.f_code.co_name
            if re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',file) and re.fullmatch(r'[A-Za-z0-9_.<>]{1,80}',function) and 1<=trace.tb_lineno<=1000000:
                frames.append({'file':file,'function':function,'line':trace.tb_lineno})
            trace=trace.tb_next
        chain.append({'type':name if name in types else 'UnknownException','message':types.get(name,'Exception message omitted'),'frames':frames[-8:]})
        error=error.reason if isinstance(error,URLError) and isinstance(error.reason,BaseException) else error.__cause__ or error.__context__
    return {'chain':chain}


def write_diagnostic(path, payload):
    temporary = path.with_name(path.name + '.tmp')
    created = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        with os.fdopen(fd, 'w') as output:
            json.dump(payload, output)
        os.replace(temporary, path)
    except OSError:
        pass  # Diagnostic I/O must not cause a second provider request.
    finally:
        if created:
            try: temporary.unlink(missing_ok=True)
            except OSError: pass


def main():
    diagnostic_path = Path(sys.argv[1])
    sys.argv = ['sprite_gen.cli', *sys.argv[2:]]
    payload = {}
    def update_http(value):
        payload['httpDiagnostic'] = value
        write_diagnostic(diagnostic_path, payload)
    try:
        with HttpDiagnostics(update_http) if sys.argv[1:2] == ['gen'] else nullcontext():
            runpy.run_module('sprite_gen.cli', run_name='__main__', alter_sys=True)
    except BaseException as error:
        if not isinstance(error, SystemExit) or error.code not in (None, 0):
            payload.update(cause=classify(error), details=error_details(error))
        raise
    finally:
        if payload: write_diagnostic(diagnostic_path, payload)


if __name__ == '__main__':
    main()
