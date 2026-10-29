"""模型服务错误应保留可排查的状态，同时避免泄露上游响应。"""
import io
import unittest
import urllib.error
from unittest.mock import patch

from service_http import ServiceError, post_json


class ServiceHTTPTests(unittest.TestCase):
    def test_http_status_is_visible_but_response_body_is_not(self):
        error = urllib.error.HTTPError('http://127.0.0.1:8045/v1/images/segment',
                                       404, 'missing secret', {}, io.BytesIO(b'secret detail'))
        with patch('service_http.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaisesRegex(ServiceError, 'HTTP 404.*SAM3_URL') as caught:
                post_json('http://127.0.0.1:8045/v1/images/segment', {})
        self.assertNotIn('secret', str(caught.exception))

    def test_connection_failure_is_distinct_from_invalid_json(self):
        with patch('service_http.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = urllib.error.URLError('connection refused')
            with self.assertRaisesRegex(ServiceError, '无法连接SAM3'):
                post_json('http://127.0.0.1:8045/v1/images/segment', {})
            opener.return_value.open.side_effect = None
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'<html>broken</html>'
            with self.assertRaisesRegex(ServiceError, '未返回有效JSON'):
                post_json('http://127.0.0.1:8045/v1/images/segment', {})


if __name__ == '__main__':
    unittest.main()
