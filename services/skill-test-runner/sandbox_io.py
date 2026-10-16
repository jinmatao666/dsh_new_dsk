"""Descriptor-relative workspace IO, invoked with Python isolated mode in sandboxes."""
import base64
import json
import os
from pathlib import PurePosixPath
import stat
import sys

ROOT = "/workspace"
MAX_FILE = 20 * 1024 * 1024


def parts(path):
    if not isinstance(path, str) or not path or "\\" in path or "\0" in path:
        raise ValueError("文件路径无效")
    p = PurePosixPath(path)
    if p.is_absolute() or any(x in ("", ".", "..") for x in path.split("/")):
        raise ValueError("只允许工作区内的相对路径")
    return path.split("/")


def parent(path, create=False):
    names = parts(path)
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in names[:-1]:
            if create:
                try:
                    os.mkdir(name, mode=0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd, names[-1]
    except BaseException:
        os.close(fd)
        raise


def perform(request):
    action = request["action"]
    path = request.get("path", "output")
    fd, name = parent(path, create=action == "write")
    try:
        if action == "list":
            directory = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                entries = []
                for item in sorted(os.listdir(directory))[:500]:
                    info = os.stat(item, dir_fd=directory, follow_symlinks=False)
                    entries.append({"name": item, "directory": stat.S_ISDIR(info.st_mode),
                                    "file": stat.S_ISREG(info.st_mode), "size": info.st_size})
                return {"entries": entries}
            finally:
                os.close(directory)
        if action == "write":
            content = base64.b64decode(request["contentBase64"], validate=True)
            if len(content) > MAX_FILE:
                raise ValueError("文件超过 20 MB")
            target = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_NONBLOCK,
                             0o600, dir_fd=fd)
            with os.fdopen(target, "wb") as output:
                if not stat.S_ISREG(os.fstat(output.fileno()).st_mode):
                    raise ValueError("不能写入特殊文件")
                output.write(content)
            return {"written": path}
        if action != "read":
            raise ValueError("不支持的文件操作")
        target = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(target, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
                raise ValueError("文件不是普通文件或超过 20 MB")
            content = source.read(MAX_FILE + 1)
            if len(content) > MAX_FILE:
                raise ValueError("文件超过 20 MB")
            return {"contentBase64": base64.b64encode(content).decode(), "size": len(content)}
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        print(json.dumps(perform(json.load(sys.stdin)), ensure_ascii=False))
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
