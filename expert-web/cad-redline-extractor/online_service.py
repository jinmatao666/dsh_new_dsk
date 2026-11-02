"""Fetch a single overlay image from WMS or ArcGIS MapServer for map 套合."""
from __future__ import annotations

import base64
import ipaddress
import json
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import urllib.request


class OnlineServiceError(ValueError):
    """User-facing online overlay failure."""


MAX_IMAGE_BYTES = 8 * 1024 * 1024
FETCH_TIMEOUT = 20


def _hostname_allowed(hostname: str) -> bool:
    if not hostname or len(hostname) > 253:
        return False
    lowered = hostname.lower().rstrip(".")
    if lowered in {"localhost"} or lowered.endswith(".localhost"):
        return False
    try:
        address = ipaddress.ip_address(lowered)
    except ValueError:
        try:
            infos = socket.getaddrinfo(lowered, None)
        except OSError as error:
            raise OnlineServiceError("无法解析服务地址主机名") from error
        for info in infos:
            try:
                address = ipaddress.ip_address(info[4][0])
            except (ValueError, IndexError):
                continue
            if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
                raise OnlineServiceError("不允许访问内网或保留地址的在线服务")
        return True
    if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
        return False
    return True


def validate_service_url(url: str) -> str:
    if not isinstance(url, str) or not 8 <= len(url) <= 2000:
        raise OnlineServiceError("服务地址无效")
    parsed = urlsplit(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise OnlineServiceError("服务地址须为 http/https，且不含用户信息或片段")
    if not _hostname_allowed(parsed.hostname):
        raise OnlineServiceError("不允许访问内网或保留地址的在线服务")
    return url.strip()


def validate_layer_name(layer: str) -> str:
    if not isinstance(layer, str):
        raise OnlineServiceError("图层名称无效")
    name = layer.strip()
    if not 1 <= len(name) <= 180 or any(ord(char) < 32 for char in name):
        raise OnlineServiceError("图层名称无效")
    return name


def validate_crs(crs: str) -> str:
    if not isinstance(crs, str):
        raise OnlineServiceError("坐标参考无效")
    value = crs.strip() or "EPSG:4326"
    if value.isdigit():
        value = f"EPSG:{value}"
    elif value.upper().startswith("EPSG:"):
        code = value.split(":", 1)[1].strip()
        if not code.isdigit():
            raise OnlineServiceError("坐标参考无效")
        value = f"EPSG:{code}"
    if not 3 <= len(value) <= 40 or any(ord(char) < 32 for char in value):
        raise OnlineServiceError("坐标参考无效")
    return value


def arcgis_wkid(crs: str) -> str:
    """ArcGIS export bboxSR/imageSR expects a numeric WKID."""
    value = validate_crs(crs)
    return value.split(":", 1)[1] if value.upper().startswith("EPSG:") else value


def normalize_arcgis_layers(layer: str) -> str:
    """MapServer /export only accepts numeric layer ids (`show:0` / `show:0,1`)."""
    name = validate_layer_name(layer)
    if name.lower().startswith("show:"):
        name = name.split(":", 1)[1].strip()
    parts = [part.strip() for part in name.split(",") if part.strip()]
    if not parts or not all(part.isdigit() for part in parts):
        raise OnlineServiceError("ArcGIS MapServer 请填写图层序号（如 0 或 0,1），不要填中文图层名")
    return f"show:{','.join(parts)}"


def validate_bbox(bbox) -> list[float]:
    if not isinstance(bbox, list) or len(bbox) != 4:
        raise OnlineServiceError("地图范围无效")
    values = []
    for item in bbox:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise OnlineServiceError("地图范围无效")
        number = float(item)
        if not (number == number) or abs(number) > 1e15:
            raise OnlineServiceError("地图范围无效")
        values.append(number)
    min_x, min_y, max_x, max_y = values
    if not (min_x < max_x and min_y < max_y):
        raise OnlineServiceError("地图范围无效")
    return values


def _is_arcgis_mapserver(url: str) -> bool:
    path = urlsplit(url).path.lower().rstrip("/")
    return path.endswith("/mapserver") or "/mapserver/" in path + "/"


def _with_query(url: str, params: dict) -> str:
    parsed = urlsplit(url)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing.update({key: value for key, value in params.items() if value is not None and value != ""})
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(existing), ""))


def validate_token(token: str) -> str:
    if token is None or token == "":
        return ""
    if not isinstance(token, str) or not 1 <= len(token) <= 4096 or any(ord(char) < 32 for char in token):
        raise OnlineServiceError("Token 无效")
    return token.strip()


def validate_credential(value: str, label: str) -> str:
    if value is None or value == "":
        return ""
    if not isinstance(value, str) or not 1 <= len(value) <= 180 or any(ord(char) < 32 for char in value):
        raise OnlineServiceError(f"{label}无效")
    return value


def arcgis_token_endpoint(service_url: str) -> str:
    """Derive the ArcGIS Server generateToken URL from a MapServer/service URL."""
    parsed = urlsplit(validate_service_url(service_url))
    return f"{parsed.scheme}://{parsed.netloc}/arcgis/tokens/generateToken"


def _outbound_ip_toward(host: str, port: int) -> str:
    """Local address used when connecting to host:port (for ArcGIS client=ip tokens)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((host, port))
            return sock.getsockname()[0]
    except OSError:
        return ""


def _arcgis_error_text(body: dict, fallback: str) -> str:
    error = body.get("error", {})
    if isinstance(error, dict):
        message = error.get("message") or ""
        details = error.get("details")
        if isinstance(details, list):
            details = "；".join(str(item) for item in details if item)
        elif details is None:
            details = ""
        else:
            details = str(details)
        text = "：".join(part for part in (str(message), details) if part)
        return text or fallback
    if error:
        return str(error)
    return str(body.get("messages") or fallback)


def generate_arcgis_token(service_url: str, username: str, password: str) -> dict:
    """Exchange username/password for an ArcGIS short-lived token.

    ArcGIS often rejects `client=requestip` from server-side proxies with
    "Client id cannot be determined". Prefer referer-bound or explicit-ip tokens.

    @returns: `{token, expires, client, referer}`
    """
    service_url = validate_service_url(service_url)
    username = validate_credential(username, "用户名")
    password = validate_credential(password, "密码")
    if not username or not password:
        raise OnlineServiceError("请同时填写用户名和密码以获取 Token")
    endpoint = arcgis_token_endpoint(service_url)
    parsed = urlsplit(service_url)
    referer = f"{parsed.scheme}://{parsed.netloc}"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    outbound_ip = _outbound_ip_toward(parsed.hostname, port)
    attempts = [
        ("referer", {"username": username, "password": password, "client": "referer", "referer": referer, "expiration": "120", "encrypted": "false", "f": "json"}),
        ("referer", {"username": username, "password": password, "client": "referer", "referer": referer + "/", "expiration": "120", "encrypted": "false", "f": "json"}),
    ]
    if outbound_ip:
        attempts.append(
            ("ip", {"username": username, "password": password, "client": "ip", "ip": outbound_ip, "expiration": "120", "encrypted": "false", "f": "json"})
        )
    attempts.append(
        ("requestip", {"username": username, "password": password, "client": "requestip", "expiration": "120", "encrypted": "false", "f": "json"})
    )
    last_error = "无法获取 ArcGIS Token"
    for client_mode, payload in attempts:
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "cad-redline-extractor-overlay/1.0",
            "Accept": "application/json",
        }
        if client_mode == "referer":
            headers["Referer"] = payload.get("referer") or referer
        request = urllib.request.Request(
            endpoint,
            data=urlencode(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
                raw = response.read(65536)
        except HTTPError as error:
            raw = error.read(65536) if hasattr(error, "read") else b""
            try:
                body = json.loads(raw.decode("utf-8", errors="replace")) if raw else {}
                last_error = _arcgis_error_text(body, f"Token 接口返回 HTTP {error.code}") if isinstance(body, dict) else f"Token 接口返回 HTTP {error.code}"
            except (UnicodeDecodeError, json.JSONDecodeError):
                last_error = f"Token 接口返回 HTTP {error.code}"
            continue
        except URLError as error:
            raise OnlineServiceError("无法连接 ArcGIS Token 接口") from error
        except TimeoutError as error:
            raise OnlineServiceError("ArcGIS Token 请求超时") from error
        try:
            body = json.loads(raw.decode("utf-8", errors="replace"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            last_error = "Token 接口返回无法解析"
            continue
        if not isinstance(body, dict):
            last_error = "Token 接口返回无效"
            continue
        if body.get("token"):
            expires = body.get("expires")
            return {
                "token": str(body["token"]),
                "expires": int(expires) if isinstance(expires, (int, float)) else None,
                "endpoint": endpoint,
                "client": client_mode,
                "referer": referer if client_mode == "referer" else "",
            }
        last_error = _arcgis_error_text(body, last_error)
    raise OnlineServiceError(last_error)


def expand_bbox(bbox: list[float], ratio: float = 0.12) -> list[float]:
    """Pad the request extent slightly so edge features still pull map content."""
    min_x, min_y, max_x, max_y = bbox
    span_x = max_x - min_x
    span_y = max_y - min_y
    pad_x = span_x * ratio if span_x > 0 else max(abs(min_x) * 0.01, 1.0)
    pad_y = span_y * ratio if span_y > 0 else max(abs(min_y) * 0.01, 1.0)
    if pad_x <= 0:
        pad_x = 1.0
    if pad_y <= 0:
        pad_y = 1.0
    return [min_x - pad_x, min_y - pad_y, max_x + pad_x, max_y + pad_y]


def _epsg_code(crs: str) -> int:
    return int(arcgis_wkid(crs))


def transform_bbox(bbox: list[float], source_crs: str, target_crs: str) -> list[float]:
    """Reproject bbox corners with pyproj; returns axis-aligned envelope in target CRS."""
    source = validate_crs(source_crs)
    target = validate_crs(target_crs)
    if source == target:
        return list(bbox)
    try:
        from pyproj import CRS, Transformer
    except ImportError as error:
        raise OnlineServiceError("缺少 pyproj，无法转换在线服务坐标参考") from error
    transformer = Transformer.from_crs(CRS.from_epsg(_epsg_code(source)), CRS.from_epsg(_epsg_code(target)), always_xy=True)
    min_x, min_y, max_x, max_y = bbox
    xs, ys = [], []
    for x, y in ((min_x, min_y), (min_x, max_y), (max_x, min_y), (max_x, max_y)):
        tx, ty = transformer.transform(x, y)
        if not (tx == tx and ty == ty):
            raise OnlineServiceError("坐标转换失败，请核对坐标参考")
        xs.append(float(tx))
        ys.append(float(ty))
    return [min(xs), min(ys), max(xs), max(ys)]


def _mapserver_export_base(service_url: str) -> str:
    base = service_url.rstrip("/")
    return base if base.lower().endswith("/export") else f"{base}/export"


def build_overlay_image_url(
    service_url: str,
    layer: str,
    bbox: list[float],
    width: int,
    height: int,
    crs: str,
    token: str = "",
    image_crs: str | None = None,
    layers_param: str | None = None,
) -> str:
    min_x, min_y, max_x, max_y = bbox
    crs = validate_crs(crs)
    image_crs = validate_crs(image_crs or crs)
    if _is_arcgis_mapserver(service_url):
        params = {
            "bbox": f"{min_x},{min_y},{max_x},{max_y}",
            "size": f"{width},{height}",
            "dpi": "96",
            "format": "png32",
            "transparent": "true",
            "f": "image",
            "bboxSR": arcgis_wkid(crs),
            "imageSR": arcgis_wkid(image_crs),
            "token": token or None,
        }
        if layers_param is None:
            params["layers"] = normalize_arcgis_layers(layer)
        elif layers_param != "":
            params["layers"] = layers_param
        return _with_query(_mapserver_export_base(service_url), params)
    return _with_query(service_url, {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetMap",
        "LAYERS": layer,
        "STYLES": "",
        "SRS": crs,
        "BBOX": f"{min_x},{min_y},{max_x},{max_y}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": "image/png",
        "TRANSPARENT": "TRUE",
        "token": token or None,
    })


def describe_mapserver(service_url: str, token: str = "", referer: str = "") -> dict:
    """Return `{crs, extent, layers}` for locate / UI; requires token when secured."""
    service_url = validate_service_url(service_url)
    token = validate_token(token)
    if referer and (not isinstance(referer, str) or len(referer) > 500 or any(ord(char) < 32 for char in referer)):
        raise OnlineServiceError("Referer 无效")
    if not referer and token:
        parsed = urlsplit(service_url)
        referer = f"{parsed.scheme}://{parsed.netloc}"
    metadata = fetch_mapserver_metadata(service_url, token=token, referer=referer)
    if not metadata:
        raise OnlineServiceError("无法读取 MapServer 元数据，请确认地址与 Token")
    wkid = mapserver_spatial_wkid(metadata)
    extent = mapserver_full_extent(metadata)
    layers = []
    for item in metadata.get("layers") or []:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        sub = item.get("subLayerIds")
        layers.append({
            "id": item.get("id"),
            "name": item.get("name") or "",
            "group": bool(isinstance(sub, list) and sub),
        })
    return {
        "crs": f"EPSG:{wkid}" if wkid else "",
        "extent": extent,
        "layers": layers,
    }


def fetch_mapserver_metadata(service_url: str, token: str = "", referer: str = "") -> dict:
    """Best-effort MapServer JSON: spatialReference + layers (may be auth-gated)."""
    service_url = validate_service_url(service_url)
    token = validate_token(token)
    meta_url = _with_query(service_url.rstrip("/"), {"f": "json", "token": token or None})
    headers = {"User-Agent": "cad-redline-extractor-overlay/1.0", "Accept": "application/json"}
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(meta_url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
            raw = response.read(1_000_000)
    except (HTTPError, URLError, TimeoutError):
        return {}
    try:
        body = json.loads(raw.decode("utf-8", errors="replace"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return body if isinstance(body, dict) and "error" not in body else {}


def mapserver_spatial_wkid(metadata: dict) -> str:
    spatial = metadata.get("spatialReference") if isinstance(metadata, dict) else None
    if not isinstance(spatial, dict):
        extent = metadata.get("fullExtent") if isinstance(metadata, dict) else None
        spatial = extent.get("spatialReference") if isinstance(extent, dict) else None
    if not isinstance(spatial, dict):
        return ""
    for key in ("latestWkid", "wkid"):
        value = spatial.get(key)
        if isinstance(value, int) or (isinstance(value, str) and str(value).isdigit()):
            return str(value)
    return ""


def resolve_arcgis_export_layers(layer: str, metadata: dict) -> list[str]:
    """Return export `layers=` candidates: requested ids, expanded group leaves, then default."""
    requested = normalize_arcgis_layers(layer)  # show:0 or show:0,1
    ids = [part for part in requested.split(":", 1)[1].split(",") if part]
    layers = metadata.get("layers") if isinstance(metadata, dict) else None
    by_id = {}
    if isinstance(layers, list):
        for item in layers:
            if isinstance(item, dict) and item.get("id") is not None:
                by_id[str(item["id"])] = item
    expanded = []
    for layer_id in ids:
        item = by_id.get(layer_id)
        sub = item.get("subLayerIds") if isinstance(item, dict) else None
        if isinstance(sub, list) and sub:
            expanded.extend(str(child) for child in sub if child is not None)
        else:
            expanded.append(layer_id)
    # Prefer leaf layers under groups; keep original as first attempt too.
    unique_expanded = []
    for layer_id in expanded:
        if layer_id not in unique_expanded:
            unique_expanded.append(layer_id)
    candidates = [requested]
    if unique_expanded and unique_expanded != ids:
        candidates.append(f"show:{','.join(unique_expanded)}")
    all_leaves = []
    for layer_id, item in by_id.items():
        sub = item.get("subLayerIds") if isinstance(item, dict) else None
        if not (isinstance(sub, list) and sub):
            all_leaves.append(layer_id)
    if all_leaves and f"show:{','.join(all_leaves)}" not in candidates:
        candidates.append(f"show:{','.join(all_leaves[:40])}")
    candidates.append("")  # service default visibility
    return candidates


def _is_probably_blank_png(data: bytes) -> bool:
    # Very small transparent exports are usually empty; keep threshold low to avoid
    # rejecting sparse-but-valid tiles from outside-service or low-ink drawings.
    return data.startswith(b"\x89PNG") and len(data) < 900


def mapserver_full_extent(metadata: dict) -> list[float] | None:
    extent = metadata.get("fullExtent") if isinstance(metadata, dict) else None
    if not isinstance(extent, dict):
        return None
    try:
        values = [float(extent["xmin"]), float(extent["ymin"]), float(extent["xmax"]), float(extent["ymax"])]
    except (KeyError, TypeError, ValueError):
        return None
    if not (values[0] < values[2] and values[1] < values[3]):
        return None
    return values


def bbox_intersects(a: list[float], b: list[float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def _blank_overlay_message(
    layer: str,
    metadata: dict,
    service_wkid: str,
    request_crs: str,
    request_bbox: list[float] | None = None,
) -> str:
    service_extent = mapserver_full_extent(metadata)
    if request_bbox and service_extent and not bbox_intersects(request_bbox, service_extent):
        return (
            "成果范围与该在线服务的数据范围不重叠（不是坐标系名称问题）。"
            f"成果约 X {request_bbox[0]:.0f}~{request_bbox[2]:.0f}，Y {request_bbox[1]:.0f}~{request_bbox[3]:.0f}；"
            f"服务 fullExtent X {service_extent[0]:.0f}~{service_extent[2]:.0f}，"
            f"Y {service_extent[1]:.0f}~{service_extent[3]:.0f}"
            + (f"（EPSG:{service_wkid}）" if service_wkid else "")
            + "。请核对 CAD 成果是否与该行政区服务同一区域"
        )
    hints = []
    layers = metadata.get("layers") if isinstance(metadata, dict) else None
    if isinstance(layers, list) and layers:
        for item in layers[:12]:
            if not isinstance(item, dict) or item.get("id") is None:
                continue
            layer_id = item.get("id")
            name = item.get("name") or ""
            sub = item.get("subLayerIds")
            kind = "组" if isinstance(sub, list) and sub else "叶"
            hints.append(f"{layer_id}={name}({kind})")
    parts = [
        "在线服务在当前请求范围内无明显要素",
        f"请求系 {validate_crs(request_crs)}" + (f"，服务系 EPSG:{service_wkid}" if service_wkid else ""),
        f"当前图层序号 {layer}",
    ]
    if hints:
        parts.append("服务图层：" + "；".join(hints))
    parts.append("可点击在线服务列表「定位」查看该图层四至")
    return "。".join(parts)


def _raise_if_arcgis_error_payload(data: bytes) -> None:
    """ArcGIS often returns HTTP 200 with text/plain JSON `{error:{code:499,...}}`."""
    text = data.lstrip().decode("utf-8", errors="replace")
    if not text[:1] in "{[":
        return
    try:
        payload = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return
    if not isinstance(payload, dict):
        return
    error = payload.get("error")
    if not isinstance(error, dict):
        return
    message = error.get("message")
    code = error.get("code")
    if code in {498, 499, 401, 403} or (isinstance(message, str) and "token" in message.lower()):
        raise OnlineServiceError("该 MapServer 需要有效 Token：请编辑在线服务，填写用户名密码重新换取，或粘贴未过期 Token")
    raise OnlineServiceError(str(message) if message else "在线服务返回错误，请核对地址、图层名与鉴权信息")


def _read_overlay_response(request_url: str, headers: dict) -> tuple[str, bytes]:
    request = urllib.request.Request(request_url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
            content_type = (response.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip().lower()
            data = response.read(MAX_IMAGE_BYTES + 1)
    except HTTPError as error:
        if error.code in {401, 403, 498, 499}:
            raise OnlineServiceError("在线服务鉴权失败，请检查 Token 或用户名密码") from error
        raw = error.read(65536) if hasattr(error, "read") else b""
        if raw:
            try:
                _raise_if_arcgis_error_payload(raw)
            except OnlineServiceError:
                raise
        raise OnlineServiceError(f"在线服务返回 HTTP {error.code}") from error
    except URLError as error:
        raise OnlineServiceError("无法连接在线服务") from error
    except TimeoutError as error:
        raise OnlineServiceError("在线服务请求超时") from error
    if len(data) > MAX_IMAGE_BYTES:
        raise OnlineServiceError("在线服务返回图像过大")
    if not data:
        raise OnlineServiceError("在线服务未返回图像")
    _raise_if_arcgis_error_payload(data)
    if content_type.startswith("application/json") or content_type.startswith("text/plain"):
        # Non-image JSON/text already handled above when it looks like ArcGIS error;
        # remaining text/plain is not a map image.
        if not data.startswith(b"\x89PNG") and data[:3] != b"GIF" and data[:2] != b"\xff\xd8":
            preview = data[:200].decode("utf-8", errors="replace").lower()
            if "token" in preview:
                raise OnlineServiceError("该 MapServer 需要有效 Token：请编辑在线服务，填写用户名密码重新换取，或粘贴未过期 Token")
            raise OnlineServiceError("在线服务未返回图像，请核对地址、图层序号与鉴权信息")
    if not content_type.startswith("image/") and not data.startswith(b"\x89PNG") and data[:3] != b"GIF" and data[:2] != b"\xff\xd8":
        preview = data[:200].decode("utf-8", errors="replace").lower()
        if "serviceexception" in preview or "<html" in preview or "token" in preview:
            raise OnlineServiceError("在线服务返回异常，请核对地址、图层序号、坐标参考与鉴权信息")
        raise OnlineServiceError("在线服务未返回有效图像")
    return content_type, data


def fetch_overlay_image(
    service_url: str,
    layer: str,
    bbox,
    width: int,
    height: int,
    crs: str = "EPSG:4326",
    token: str = "",
    username: str = "",
    password: str = "",
    referer: str = "",
) -> dict:
    """Return `{contentType, imageBase64, requestUrl, token}` for canvas overlay.

    ArcGIS secured services: pass an existing token, or username/password to generate one.
    Referer-bound tokens must send the same Referer on export requests.
    MapServer group layers and CRS mismatches are retried automatically.
    """
    service_url = validate_service_url(service_url)
    layer = validate_layer_name(layer)
    if _is_arcgis_mapserver(service_url):
        normalize_arcgis_layers(layer)
    crs = validate_crs(crs)
    bbox = expand_bbox(validate_bbox(bbox))
    token = validate_token(token)
    username = validate_credential(username, "用户名")
    password = validate_credential(password, "密码")
    if referer and (not isinstance(referer, str) or len(referer) > 500 or any(ord(char) < 32 for char in referer)):
        raise OnlineServiceError("Referer 无效")
    if not isinstance(width, int) or not isinstance(height, int) or not 64 <= width <= 2048 or not 64 <= height <= 2048:
        raise OnlineServiceError("地图尺寸无效")
    issued = None
    if not token and username and password and _is_arcgis_mapserver(service_url):
        issued = generate_arcgis_token(service_url, username, password)
        token = issued["token"]
        referer = issued.get("referer") or referer
    if _is_arcgis_mapserver(service_url) and not token:
        raise OnlineServiceError("该 MapServer 需要 Token：请在在线服务中填写用户名密码换取，或粘贴 Token 后再套合")
    if not referer and token and _is_arcgis_mapserver(service_url):
        parsed = urlsplit(service_url)
        referer = f"{parsed.scheme}://{parsed.netloc}"
    headers = {"User-Agent": "cad-redline-extractor-overlay/1.0", "Accept": "image/*,*/*"}
    if referer:
        headers["Referer"] = referer
    if username and password and not _is_arcgis_mapserver(service_url) and not token:
        basic = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {basic}"

    attempts: list[tuple[list[float], str, str, str | None]] = []
    # (bbox, bbox_crs, image_crs, layers_param)
    metadata: dict = {}
    service_wkid = ""
    if _is_arcgis_mapserver(service_url):
        metadata = fetch_mapserver_metadata(service_url, token=token, referer=referer)
        service_wkid = mapserver_spatial_wkid(metadata)
        layer_candidates = resolve_arcgis_export_layers(layer, metadata)
        for layers_param in layer_candidates:
            attempts.append((bbox, crs, crs, layers_param))
        wide = expand_bbox(bbox, ratio=0.45)
        for layers_param in layer_candidates[:2]:
            attempts.append((wide, crs, crs, layers_param))
        if service_wkid and f"EPSG:{service_wkid}" != crs:
            try:
                service_bbox = expand_bbox(transform_bbox(bbox, crs, f"EPSG:{service_wkid}"), ratio=0.2)
            except OnlineServiceError:
                service_bbox = None
            if service_bbox:
                for layers_param in layer_candidates[:3]:
                    # Keep imageSR = data CRS so the PNG aligns with canvas vectors.
                    attempts.append((service_bbox, f"EPSG:{service_wkid}", crs, layers_param))
    else:
        attempts.append((bbox, crs, crs, None))

    service_extent = mapserver_full_extent(metadata) if metadata else None
    # Non-overlapping result/service extents are allowed: still export so the map can
    # show whichever side is in view after the user locates to a layer's own extent.

    last_blank = False
    last_url = ""
    content_type = "image/png"
    data = b""
    used_bbox = bbox
    used_crs = crs
    warning = ""
    for attempt_bbox, bbox_crs, image_crs, layers_param in attempts:
        request_url = build_overlay_image_url(
            service_url,
            layer,
            attempt_bbox,
            width,
            height,
            bbox_crs,
            token=token,
            image_crs=image_crs,
            layers_param=layers_param if _is_arcgis_mapserver(service_url) else None,
        )
        last_url = request_url
        content_type, data = _read_overlay_response(request_url, headers)
        if _is_probably_blank_png(data):
            last_blank = True
            continue
        used_bbox = attempt_bbox
        used_crs = image_crs
        last_blank = False
        break
    else:
        if last_blank and data.startswith(b"\x89PNG"):
            warning = _blank_overlay_message(layer, metadata, service_wkid, crs, bbox)
            used_bbox = bbox
            used_crs = crs
        else:
            # Still return service extent so the client can widen the next request.
            hint = _blank_overlay_message(layer, metadata, service_wkid, crs, bbox)
            error = OnlineServiceError(hint)
            error.extent = service_extent
            error.service_crs = f"EPSG:{service_wkid}" if service_wkid else ""
            raise error

    result = {
        "contentType": content_type if content_type.startswith("image/") else "image/png",
        "imageBase64": base64.b64encode(data).decode("ascii"),
        "requestUrl": last_url.split("token=")[0] + ("token=***" if token else ""),
        "bbox": used_bbox,
        "crs": used_crs,
    }
    if service_extent:
        result["extent"] = service_extent
    if service_wkid:
        result["serviceCrs"] = f"EPSG:{service_wkid}"
    if warning:
        result["warning"] = warning
    if token:
        result["token"] = token
    if referer:
        result["referer"] = referer
    if issued and issued.get("expires") is not None:
        result["expires"] = issued["expires"]
    if issued and issued.get("client"):
        result["client"] = issued["client"]
    return result
