#!/usr/bin/env python3
"""Move recognized legacy DSH build/backup files under /root/dsh without changing containers."""
import contextlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def destination_group(name, directory):
    """Return the storage group for a recognized legacy filename; reject unrelated files."""
    if directory:
        if re.fullmatch(r'dsh-one-api-build\.[A-Za-z0-9]+|dsh-vector-build-[0-9][A-Za-z0-9.-]*', name):
            return 'builds'
        if re.fullmatch(r'dsh-one-api-update\.[A-Za-z0-9]+', name):
            return 'updates'
        if re.fullmatch(r'dsh-(gateway-tunnel|nginx-routes)\.[A-Za-z0-9]+', name):
            return 'backups/gateway'
        if re.fullmatch(r'dsh-migration-[0-9]+', name):
            return 'backups/migrations'
    elif re.fullmatch(r'dsh-one-api-[0-9][A-Za-z0-9.-]*\.(tar|private\.json)|dsh-files-[0-9]+\.tar\.gz', name):
        return 'backups/migrations'
    return None


def safe_directory(path, create=False):
    """Reject links and non-directories before optionally creating private destination parents."""
    for entry in reversed([path, *path.parents]):
        if entry.is_symlink() or (entry.exists() and not entry.is_dir()):
            raise RuntimeError('Unsafe directory: ' + str(entry))
        if create and not entry.exists():
            entry.mkdir(mode=0o700)


def plan(root, mounts):
    """Plan exact renames and reject destination conflicts or any affected container mount."""
    safe_directory(root)
    moves = []
    for source in sorted(root.iterdir()):
        group = destination_group(source.name, source.is_dir())
        if not group:
            continue
        if source.is_symlink() or source.resolve() != source:
            raise RuntimeError('Legacy entry must not be a symlink: ' + str(source))
        dest = root / 'dsh' / group / source.name
        safe_directory(dest.parent)
        if dest.exists() or dest.is_symlink():
            raise RuntimeError('Destination already exists: ' + str(dest))
        for mounted in mounts:
            bound = Path(mounted).resolve()
            if bound == source or source in bound.parents or bound in source.parents:
                raise RuntimeError('Container mount overlaps legacy entry; manual migration required: ' + str(source))
        moves.append((source, dest))
    return moves


def apply(moves, storage):
    """Rename the reviewed entries, retaining a private move journal and reversing on failure."""
    safe_directory(storage / 'updates', create=True)
    for source, dest in moves:
        safe_directory(dest.parent, create=True)
        if source.is_symlink() or dest.exists() or dest.is_symlink():
            raise RuntimeError('Path changed since preflight: ' + str(source))
    fd, journal = tempfile.mkstemp(prefix='layout-migration.', suffix='.json', dir=storage / 'updates')
    completed = []
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as record:
            record.write(json.dumps({'moves': [[str(a), str(b)] for a, b in moves]}, indent=2) + '\n')
            record.flush()
            os.fsync(record.fileno())
        for source, dest in moves:
            # Same-filesystem rename fails instead of partially copying live state across mounts.
            source.rename(dest)
            completed.append((source, dest))
    except Exception:
        for source, dest in reversed(completed):
            if source.exists() or source.is_symlink():
                raise RuntimeError('Automatic reversal blocked; inspect migration journal: ' + journal)
            dest.rename(source)
        raise
    return journal


def docker_mounts():
    """Read mount sources only, including stopped rollback containers, without exposing credentials."""
    env = dict(os.environ, DOCKER_HOST='unix:///var/run/docker.sock')
    for key in ('DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
        env.pop(key, None)
    ids = subprocess.run(['docker', 'ps', '-aq'], check=True, capture_output=True, text=True, env=env, timeout=30).stdout.split()
    if not ids:
        return []
    raw = subprocess.run(['docker', 'inspect', '--format', '{{json .Mounts}}', *ids], check=True,
                         capture_output=True, text=True, env=env, timeout=30).stdout
    return [item['Source'] for line in raw.splitlines() for item in json.loads(line) if item.get('Source')]


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('check', 'apply'):
        raise RuntimeError('Usage: python3 organize-oneapi.py check|apply')
    if os.geteuid() != 0:
        raise RuntimeError('Run as root.')
    import fcntl  # Linux server only; pure planning functions remain testable on Windows.
    os.umask(0o077)
    with contextlib.ExitStack() as locks:
        for name in ('dsh-one-api-update.lock', 'dsh-gateway-tunnel.lock'):
            lock = locks.enter_context(open('/var/lock/' + name, 'a'))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        moves = plan(Path('/root'), docker_mounts())
        for source, dest in moves:
            print(str(source) + ' -> ' + str(dest))
        if sys.argv[1] == 'apply' and moves:
            print('Move journal: ' + apply(moves, Path('/root/dsh')))
        print('Moved' if sys.argv[1] == 'apply' else 'Planned', len(moves), 'entries; no containers or mounted data changed.')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print('Layout operation stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, subprocess.SubprocessError, ValueError):
        # Command output and filesystem contents can contain secrets; do not dump exception payloads.
        print('Layout operation stopped. Check container mounts, destination conflicts, permissions and deployment locks.', file=sys.stderr)
        sys.exit(1)
