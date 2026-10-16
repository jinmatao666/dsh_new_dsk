"""Linux/Docker acceptance: real isolated execution, symlink rejection and cleanup.

Run only on a test host. This script allocates and removes its own labeled session.
It calls the manager internally; it does not call OneAPI or consume model quota.
"""
import base64
import json
import os
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

endpoint = os.environ.get("SKILL_TEST_RUNNER_URL", "http://skill-test-runner:9080").rstrip("/")
secret = os.environ["SKILL_TEST_RUNNER_SECRET"]
session = uuid.uuid4().hex


def call(action, **payload):
    request = Request(endpoint + action, data=json.dumps({"session": session, **payload}).encode(),
                      headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json"})
    with urlopen(request, timeout=180) as response:
        return json.load(response)


def execute(command):
    result = call("/tool", tool="execute", arguments={"command": command})
    assert result["exit_code"] == 0 and not result["limited"], result
    return result["output"]


created = False
try:
    call("/health")
    call("/create", owner=2147483647, files=[{"path": "SKILL.md", "contentBase64": base64.b64encode(b"# Smoke fixture").decode()}])
    created = True
    assert execute("id -u").strip() == "65532"
    execute("test ! -S /var/run/docker.sock && test ! -e /data")
    execute("test ! -w skill/SKILL.md && test ! -w /usr/local/lib")
    execute("python -c \"import socket; s=socket.socket(); s.settimeout(2); r=s.connect_ex(('1.1.1.1',443)); assert r != 0\"")
    call("/upload", files=[{"name": "input.txt", "contentBase64": "YWJj"}])
    execute("python -c \"from pathlib import Path; Path('output/result.txt').write_text(Path('input/input.txt').read_text().upper())\"")
    execute("ln -s /etc/passwd output/escape.txt")
    try:
        call("/download", name="escape.txt")
        raise AssertionError("symlink accepted")
    except HTTPError as error:
        assert error.code == 400
    assert [x["name"] for x in call("/files")["files"]] == ["result.txt"]
    call("/finish")
    assert not call("/status")["active"]
    assert base64.b64decode(call("/download", name="result.txt")["contentBase64"]) == b"ABC"
    print("PASS: non-root/no-network/read-only snapshot, real execution, symlink rejection, retained output, deletion")
finally:
    if created:
        call("/finish")
