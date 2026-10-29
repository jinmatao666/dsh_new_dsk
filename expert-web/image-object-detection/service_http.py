"""Bounded JSON calls to explicitly configured, administrator-owned services."""
import json
import os
import socket
import urllib.error
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
    except urllib.error.HTTPError as error:
        # 只显示状态码，不透出上游响应体、地址或鉴权信息。
        if error.code == 400:
            detail = '请求参数被拒绝，请检查SAM3_API与服务接口版本'
        elif error.code in (401, 403):
            detail = '鉴权失败，请检查SAM3_KEY'
        elif error.code == 404:
            detail = '接口不存在，请检查SAM3_URL和SAM3_API'
        elif error.code == 429:
            detail = '请求过多，请稍后重试'
        elif error.code == 503:
            detail = '模型服务暂不可用或正在处理其他任务'
        else:
            detail = '模型服务返回错误'
        raise ServiceError(f'SAM3识别服务返回HTTP {error.code}：{detail}') from None
    except (TimeoutError, socket.timeout):
        raise ServiceError('SAM3识别服务请求超时，请检查模型服务状态') from None
    except urllib.error.URLError:
        raise ServiceError('无法连接SAM3识别服务，请检查服务地址和运行状态') from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ServiceError('SAM3识别服务未返回有效JSON，请检查接口版本') from None
    except (ValueError, TypeError):
        raise ServiceError('SAM3识别服务返回数据无效或过大，请检查接口版本') from None
    except OSError:
        raise ServiceError('无法连接SAM3识别服务，请检查服务地址和运行状态') from None
