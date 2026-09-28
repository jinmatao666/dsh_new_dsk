"""Local deployment checks. No credentials, URL values, or user records are printed."""
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit


def valid_url(value, internal=False, origin=False):
    try:
        parsed = urlsplit(value)
        parsed.port
        if parsed.scheme not in (("http", "https") if internal else ("https",)):
            return False
        if not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.query:
            return False
        if parsed.hostname.endswith(".example.com") or parsed.hostname == "example.com":
            return False
        return not origin or parsed.path in ("", "/")
    except ValueError:
        return False


def local_model_url(value):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1")
                and parsed.port == 20330 and parsed.path == "/v1/chat/completions"
                and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)
    except ValueError:
        return False


def configured(name):
    value = os.environ.get(name, "").strip()
    return bool(value) and not value.startswith("replace-with-")


def executable(variable, fallback):
    explicit = os.environ.get(variable)
    if explicit:
        path = Path(explicit)
        return path.is_file() and os.access(path, os.X_OK)
    return bool(shutil.which(fallback))


def checks():
    result = {
        "public_origin": valid_url(os.environ.get("EXPERT_PUBLIC_URL", ""), internal=True, origin=True),
        "identity_endpoint": valid_url(os.environ.get("EXPERT_PLATFORM_REDEEM_URL", ""), internal=True),
        "provider_credential": configured("EXPERT_PROVIDER_CREDENTIAL"),
    }
    model_url = os.environ.get("EXPERT_MODEL_URL", "")
    result["model_url"] = valid_url(model_url) or local_model_url(model_url)
    result["model_id"] = configured("EXPERT_MODEL")
    result["model_key"] = local_model_url(model_url) or configured("EXPERT_MODEL_KEY")
    return result


def ready():
    return all(checks().values())


if __name__ == "__main__":
    results = checks()
    for name, passed in results.items():
        print(f"{name}: {'OK' if passed else 'NOT READY'}")
    print("These are local configuration checks, not proof of live remote service access.")
    raise SystemExit(0 if all(results.values()) else 1)
