"""Scoped HTTP metadata capture in a single CLI subprocess; no bodies or secrets."""
import http.client
import re

PREFIX = 'PET_HTTP_DIAGNOSTIC '
MAX_BYTES = (1 << 53) - 1
REQUEST_ID = re.compile(r'(?:req_[a-f0-9]{32}|[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})')
CF_RAY = re.compile(r'[a-f0-9]{12,32}-[A-Z]{3}')


def read_http_diagnostic(value):
    if not isinstance(value, dict):
        return None
    if any(key not in value for key in ('status', 'expectedBodyBytes', 'receivedBodyBytes')):
        return None
    for key, low, high, nullable in [('status', 100, 599, True), ('expectedBodyBytes', 0, MAX_BYTES, True), ('receivedBodyBytes', 0, MAX_BYTES, False)]:
        item = value.get(key)
        if nullable and item is None:
            continue
        if type(item) is not int or not low <= item <= high:
            return None
    if any(type(value.get(key)) is not bool for key in ('receivedBodyBytesExact', 'bodyComplete', 'chunked')):
        return None
    if value.get('phase') not in ('before_headers', 'body', 'complete'):
        return None
    result = {key: value.get(key) for key in ('status', 'expectedBodyBytes', 'receivedBodyBytes', 'receivedBodyBytesExact', 'bodyComplete', 'chunked', 'phase')}
    for key, pattern in [('requestId', REQUEST_ID), ('cfRay', CF_RAY)]:
        item = value.get(key)
        result[key] = item if isinstance(item, str) and pattern.fullmatch(item) else None
    return result


class HttpDiagnostics:
    def __init__(self, on_update=None):
        self.on_update = on_update
        self.response = None
        self.record = {'status': None, 'expectedBodyBytes': None, 'receivedBodyBytes': 0,
                       'receivedBodyBytesExact': False, 'bodyComplete': False,
                       'chunked': False, 'phase': 'before_headers', 'requestId': None, 'cfRay': None}

    def snapshot(self):
        return read_http_diagnostic(self.record)

    def publish(self):
        if self.on_update:
            try:
                value = self.snapshot()
                if value is not None:
                    self.on_update(value)
            except Exception:
                pass  # Logging failure must not change a paid request's outcome.

    def __enter__(self):
        self.original_begin = http.client.HTTPResponse.begin
        self.original_read = http.client.HTTPResponse.read

        def begin(response):
            result = self.original_begin(response)
            if response._method != 'CONNECT':
                self.response = response
                length = response.getheader('Content-Length', '')
                expected = int(length) if re.fullmatch(r'[0-9]{1,16}', length) else None
                self.record.update(status=response.status,
                                   expectedBodyBytes=expected if expected is not None and expected <= MAX_BYTES and not response.chunked else None,
                                   receivedBodyBytes=0, receivedBodyBytesExact=False, bodyComplete=False,
                                   chunked=response.chunked, phase='body',
                                   requestId=response.getheader('X-Request-ID'), cfRay=response.getheader('CF-Ray'))
                self.publish()
            return result

        def read(response, amt=None):
            if response is not self.response:
                return self.original_read(response, amt)
            self.record.update(phase='body', receivedBodyBytesExact=False, bodyComplete=False)
            self.publish()
            try:
                data = self.original_read(response, amt)
            except http.client.IncompleteRead as error:
                self.record['receivedBodyBytes'] += len(error.partial)
                # A partial chunk can be absent from IncompleteRead.partial; do not
                # claim an exact total. Fixed Content-Length reads expose the prefix.
                self.record['receivedBodyBytesExact'] = not response.chunked
                self.publish()
                raise
            except BaseException:
                self.publish()
                raise
            self.record['receivedBodyBytes'] += len(data)
            complete = amt is None or response.isclosed()
            self.record.update(receivedBodyBytesExact=True, bodyComplete=complete,
                               phase='complete' if complete else 'body')
            self.publish()
            return data

        http.client.HTTPResponse.begin = begin
        http.client.HTTPResponse.read = read
        self.publish()
        return self

    def __exit__(self, *args):
        http.client.HTTPResponse.begin = self.original_begin
        http.client.HTTPResponse.read = self.original_read
