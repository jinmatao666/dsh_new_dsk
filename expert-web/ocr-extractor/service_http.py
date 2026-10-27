"""Bounded JSON calls to explicitly configured, administrator-owned services."""
import json
import os
import urllib.request
from urllib.parse import urlsplit


class ServiceError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def valid_service_url(value, allow_http=False):
    try:
        p = urlsplit(value)
        p.port
        local = p.hostname in ('127.0.0.1', 'localhost', '::1')
        return bool(p.hostname and not p.username and not p.password and not p.query and not p.fragment
                    and (p.scheme == 'https' or (p.scheme == 'http' and
                         (local or allow_http or os.environ.get('EXPERT_ALLOW_HTTP_ENGINE') == '1'))))
    except ValueError:
        return False


def post_json(url, payload, key='', timeout=80, limit=32 * 1024 * 1024, allow_http=False):
    if not valid_service_url(url, allow_http=allow_http):
        raise ServiceError('识别服务地址未配置或协议不允许')
    try:
        data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        req = urllib.request.Request(url, data=data, headers={
            'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + key} if key else {})})
        # Identity, engine and formatting credentials are never forwarded through redirects.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
        with opener.open(req, timeout=timeout) as response:
            raw = response.read(limit + 1)
        if len(raw) > limit:
            raise ValueError('response too large')
        def reject(value):
            raise ValueError(value)
        result = json.loads(raw, parse_constant=reject)
        if not isinstance(result, dict):
            raise ValueError('not object')
        return result
    except (OSError, ValueError, TypeError):
        raise ServiceError('识别服务调用失败或返回数据无效，请检查服务连接及接口版本') from None
