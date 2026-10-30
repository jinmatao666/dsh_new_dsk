#!/usr/bin/env python3
"""Standalone Docker delivery; all deployment-specific values remain in .env."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def run(args, *, capture=False, env=None):
    """Run without a shell; never echo expanded configuration or credentials."""
    result = subprocess.run(args, cwd=ROOT, env=env, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if result.returncode:
        # Compose errors can contain expanded secret values; keep them out of diagnostics.
        raise ValueError(f"{args[0]} {args[1]} failed (exit {result.returncode}); check local configuration, image availability and Docker access")
    return result.stdout if capture else None


def compose(*args, env=None, capture=False):
    return run(["docker", "compose", "--env-file", str(ROOT / ".env"),
                "-f", str(ROOT / "compose.yaml"), *args], env=env, capture=capture)


def versioned(image):
    if not image or re.search(r"\s|SET_VERSION|REGISTRY", image):
        raise ValueError("DSH_IMAGE must name a published version or digest")
    if "@sha256:" not in image and (":" not in image.rsplit("/", 1)[-1] or image.endswith(":latest")):
        raise ValueError("Use a version tag or image digest, not an unversioned/latest image")


def configuration(image=None):
    if not (ROOT / ".env").is_file():
        raise ValueError("Missing .env; run init and fill DSH_PUBLIC_URL before check/up")
    environment = dict(os.environ)
    if image:
        versioned(image)
        environment["DSH_IMAGE"] = image
    data = json.loads(compose("config", "--format", "json", env=environment, capture=True))
    service = data["services"]["backend"]
    versioned(service["image"])
    settings = service["environment"]
    if not settings.get("DSH_PUBLIC_URL"):
        raise ValueError("DSH_PUBLIC_URL is required: complete external HTTP(S) API URL, including its prefix")
    for key in ("SESSION_SECRET", "PARVIS_CHANNEL_KEY_ENCRYPTION_KEY"):
        value = settings.get(key) or ""
        if len(value) < 32 or value.startswith(("replace", "random_string")):
            raise ValueError(f"{key} must contain a persistent random secret (at least 32 characters)")
    return service, environment


def check(image=None):
    service, environment = configuration(image)
    info = json.loads(run(["docker", "image", "inspect", service["image"]], capture=True))[0]
    platform = service.get("platform", "linux/amd64")
    actual = info["Os"] + "/" + info["Architecture"]
    if actual != platform:
        raise ValueError(f"Image architecture {actual} does not match DSH_PLATFORM={platform}")
    # No DB, expert services, network, mounts or production container are needed here.
    # Compose expands quotes/interpolation; Docker's raw env-file parser does not.
    # Pass the resolved values in a private temporary file, never in process arguments.
    with tempfile.TemporaryDirectory(prefix="dsh-check-") as directory:
        runtime_env = Path(directory) / "environment"
        entries = []
        for key, value in service["environment"].items():
            if value is None: continue
            if "\n" in str(value) or "\r" in str(value):
                raise ValueError(f"{key} must use a single-line environment value")
            entries.append(key + "=" + str(value))
        write_private(runtime_env, "\n".join(entries) + "\n")
        run(["docker", "run", "--rm", "--network", "none", "--env-file", str(runtime_env),
             "--entrypoint", "/one-api", service["image"], "--check-deployment"])
    print("Configuration and local image checks passed; no running service was changed.")
    return environment


def write_private(path, content):
    # Exclusive creation protects existing site configuration from template overwrites.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(content)


def replace_image(text, image):
    versioned(image)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@-]*", image):
        raise ValueError("Image reference contains unsupported characters")
    if not re.search(r"^DSH_IMAGE=", text, flags=re.M):
        raise ValueError(".env needs exactly one unexported DSH_IMAGE= line")
    if len(re.findall(r"^DSH_IMAGE=", text, flags=re.M)) != 1:
        raise ValueError("Duplicate DSH_IMAGE lines in .env")
    return re.sub(r"^DSH_IMAGE=.*$", "DSH_IMAGE=" + image, text, flags=re.M)


def update(image):
    # Require a local candidate; offline sites use docker load, online sites docker pull.
    check(image)
    target = ROOT / ".env"
    content = target.read_text(encoding="utf-8")
    updated = replace_image(content, image)
    backup = ROOT / (".env.before-image-" + secrets.token_hex(6))
    write_private(backup, content)
    temporary = ROOT / (".env.next-" + secrets.token_hex(6))
    write_private(temporary, updated)
    os.replace(temporary, target)
    print(f"Saved previous site configuration to {backup.name}.")
    # The candidate image is now persisted in .env. Ignore a stale shell override.
    environment = dict(os.environ)
    environment["DSH_IMAGE"] = image
    compose("up", "-d", "--no-build", "--pull", "never", "backend", env=environment)
    print(f"Image replaced; configuration backup: {backup.name}. Database and data volumes were retained.")


def export(image, output):
    versioned(image)
    output = Path(output).resolve()
    if output.exists():
        raise ValueError("Export destination already exists")
    metadata = json.loads(run(["docker", "image", "inspect", image], capture=True))[0]
    run(["docker", "save", "--output", str(output), image])
    digest = hashlib.sha256()
    with output.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    output.with_suffix(output.suffix + ".sha256").write_text(digest.hexdigest() + "  " + output.name + "\n", encoding="utf-8")
    output.with_suffix(output.suffix + ".json").write_text(json.dumps({
        "image": image, "id": metadata["Id"], "digests": metadata.get("RepoDigests", []),
        "os": metadata["Os"], "architecture": metadata["Architecture"],
        "version": metadata.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.version"),
        "sha256": digest.hexdigest(),
    }, indent=2) + "\n", encoding="utf-8")
    print("Image, identity manifest and SHA256 exported. Copy this deployment directory without its local .env/data.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="create local .env once; never overwrite")
    init.add_argument("--image", required=True)
    commands.add_parser("check", help="validate config and loaded image without starting services")
    commands.add_parser("up", help="create/recreate this Compose project using a checked local image")
    for name in ("update", "rollback"):
        command = commands.add_parser(name, help="replace program image, preserve site configuration and data")
        command.add_argument("--image", required=True)
    build = commands.add_parser("build", help="build one version for one architecture")
    build.add_argument("--image", required=True)
    build.add_argument("--version", required=True)
    build.add_argument("--platform", choices=("linux/amd64", "linux/arm64"), required=True)
    save = commands.add_parser("export", help="export the tested image unchanged with checksum and identity")
    save.add_argument("--image", required=True)
    save.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "init":
        content = replace_image((ROOT / ".env.example").read_text(encoding="utf-8"), args.image)
        content = content.replace("SESSION_SECRET=\n", "SESSION_SECRET=" + secrets.token_hex(32) + "\n")
        content = content.replace("PARVIS_CHANNEL_KEY_ENCRYPTION_KEY=\n", "PARVIS_CHANNEL_KEY_ENCRYPTION_KEY=" + secrets.token_hex(32) + "\n")
        write_private(ROOT / ".env", content)
        print("Created .env with persistent secrets. Fill the public URL, paths, origins and local database settings.")
    elif args.command == "check":
        check()
    elif args.command == "up":
        environment = check()
        compose("up", "-d", "--no-build", "--pull", "never", "backend", env=environment)
    elif args.command in ("update", "rollback"):
        update(args.image)
    elif args.command == "build":
        versioned(args.image)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.version):
            raise ValueError("Version must be a release identifier")
        run(["docker", "buildx", "build", "--load", "--platform", args.platform,
             "--build-arg", "PARVIS_VERSION=" + args.version,
             "--label", "org.opencontainers.image.version=" + args.version,
             "-t", args.image, "-f", str(ROOT.parent / "Dockerfile"), str(ROOT.parent)])
    elif args.command == "export":
        export(args.image, args.output)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        print("Deployment failed: " + str(error), file=sys.stderr)
        sys.exit(2)
