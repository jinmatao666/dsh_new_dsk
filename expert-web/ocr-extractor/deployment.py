"""Configuration checks for this independent OCR site; never print secrets."""
import os
from urllib.parse import urlsplit
from service_http import valid_service_url


def valid_url(value, origin=False, allow_http=False):
    try:
        parsed = urlsplit(value)
        parsed.port
        return (parsed.scheme in (("https", "http") if allow_http else ("https",))
                and bool(parsed.hostname) and not parsed.username and not parsed.password
                and not parsed.query and not parsed.fragment
                and (not origin or parsed.path in ("", "/"))
                and ".example" not in parsed.hostname)
    except ValueError:
        return False


def model_configuration():
    endpoint = os.environ.get("EXPERT_MODEL_URL", "")
    try:
        parsed = urlsplit(endpoint)
        parsed.port
    except ValueError:
        return False
    local = parsed.hostname in ("127.0.0.1", "::1", "localhost")
    allowed_http = local or os.environ.get("EXPERT_ALLOW_HTTP_MODEL") == "1"
    return (valid_url(endpoint, allow_http=allowed_http)
            and bool(os.environ.get("EXPERT_MODEL", "").strip())
            and (local or bool(os.environ.get("EXPERT_MODEL_KEY", "").strip())))


def checks():
    return {
        "public_origin": valid_url(os.environ.get("EXPERT_PUBLIC_URL", ""), origin=True, allow_http=True),
        "identity_endpoint": valid_url(os.environ.get("EXPERT_PLATFORM_REDEEM_URL", ""), allow_http=True),
        "provider_credential": bool(os.environ.get("EXPERT_PROVIDER_CREDENTIAL", "")) and not os.environ.get("EXPERT_PROVIDER_CREDENTIAL", "").startswith("replace-with-"),
        "paddleocr_configured": valid_service_url(os.environ.get('PADDLEOCR_URL', '')),
        "paddleocr_api": os.environ.get('PADDLEOCR_API', 'ocr') in ('ocr', 'layout'),
    }


def ready():
    return all(checks().values())


if __name__ == "__main__":
    for name, result in checks().items():
        print(f"{name}: {'OK' if result else 'NOT READY'}")
    print("Configuration only; a real image task must verify model connectivity and vision support.")
    raise SystemExit(0 if ready() else 1)
