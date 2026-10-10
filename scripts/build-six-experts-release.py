"""Package a pinned Git revision; reject missing reporters and private/runtime files."""
import argparse
import ast
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import zipfile

SITES = ("meeting-minutes", "document-processing", "file-conversion", "geology", "third-survey", "planning-review")
ROOT = Path(__file__).resolve().parent.parent


def validate_archive(data):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
                raise ValueError("Unsafe source archive member")
            if path.name.startswith(".env") and not path.name.endswith(".example"):
                raise ValueError("Private environment file in release")
            if "__pycache__" in path.parts or path.suffix in (".pyc", ".db", ".sqlite", ".sqlite3"):
                raise ValueError("Runtime file in release")
        for site in SITES:
            prefix = "expert-web/" + site + "/"
            server = archive.extractfile(prefix + "server.py").read().decode()
            tree = ast.parse(server)
            functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
            if "report_usage" not in functions or '"/usage"' not in server:
                raise ValueError(site + ": missing usage reporter")
            entry = ast.get_source_segment(server, functions["create_server"])
            if "target=report_usage" not in entry or entry.index("worker.submit(") > entry.index("target=report_usage"):
                raise ValueError(site + ": missing accepted-task reporting hook")
            for filename in ("Dockerfile", "requirements.txt", "compose.local-xinference.yml", "test_usage.py"):
                archive.getmember(prefix + filename)
            compose = archive.extractfile(prefix + "compose.local-xinference.yml").read().decode()
            if "network_mode: host" not in compose or "ports:" in compose:
                raise ValueError(site + ": deployment topology changed")


def build(version, destination):
    if not re.fullmatch(r"\d{8}\.\d+", version):
        raise ValueError("Version must be YYYYMMDD.N")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    data = subprocess.check_output(["git", "archive", "--format=tar.gz", revision,
                                    *("expert-web/" + site for site in SITES)], cwd=ROOT)
    validate_archive(data)
    archive_name = f"wanwei-six-experts-{version}.tar.gz"
    script_name = f"update-six-experts-{version}.sh"
    digest = hashlib.sha256(data).hexdigest()
    files = {
        archive_name: data,
        archive_name + ".sha256": (digest + "  " + archive_name + "\n").encode(),
        script_name: (ROOT / "scripts/update-six-experts.template.sh").read_text(encoding="utf-8").replace("@VERSION@", version).encode(),
        "release.json": (json.dumps({"version": version, "source_commit": revision, "sites": SITES,
                                     "archive_sha256": digest}, ensure_ascii=False, indent=2) + "\n").encode(),
        "README.zh.md": f"""# 六站使用量上报更新 {version}

这是六站源码更新包，在服务器构建镜像，不是桌面安装包，也不包含 OneAPI 镜像。
来源提交：`{revision}`。包含六站任务提交后的使用上报；只打开专家不计数。
保留现有 .env、host 网络和 /data 数据卷。六站继续使用本机 3301–3306；不修改 Nginx 3300、OneAPI 127.0.0.1:13300 或六站公网地址。
先确认 OneAPI usage 后台版本已经部署，且没有正在执行的专家任务。更新前建议备份六站数据卷；旧镜像回退不等同于数据回退。

把此 ZIP 上传至 `/root/dsh-experts/`，执行：

```sh
cd /root/dsh-experts
unzip wanwei-six-experts-{version}-usage-release.zip -d upload-{version}
cp upload-{version}/wanwei-six-experts-{version}.tar.gz upload-{version}/wanwei-six-experts-{version}.tar.gz.sha256 upload-{version}/{script_name} .
bash {script_name} check
bash {script_name} prepare
bash {script_name} update-all
bash {script_name} status
```

`check` 不部署，用无效输入检测 OneAPI 上报路由，不能产生统计记录。`prepare` 保留旧配置和旧镜像但不重启；发布目录已存在时停止，不覆盖。`update-all` 逐站构建并更新。构建或检查失败时停止；此前已更新的站点不会自动回退。

单站回退示例：`bash {script_name} rollback geology`，其余目录名见 release.json。不要运行网关切换脚本或 OneAPI 部署脚本。
更新后从桌面打开专家并实际提交一项任务，在后台“专家明细”核对新增记录。历史使用不会自动补记；不要用伪造任务请求测试统计。
源码包含上报代码不代表生产链路已验证。上报失败目前尝试三次，不持久排队，也不输出失败日志；任务执行不被上报失败阻塞。
本地已运行六站使用上报与部署配置测试；本机无 Docker，镜像构建及生产统计验收需在服务器完成。
""".encode(),
    }
    destination.mkdir(parents=True, exist_ok=True)
    zip_path = destination / f"wanwei-six-experts-{version}-usage-release.zip"
    for name in (*files, zip_path.name, zip_path.name + ".sha256"):
        if (destination / name).exists():
            raise FileExistsError("Will not overwrite " + name)
    for name, content in files.items():
        (destination / name).write_bytes(content)
    with zipfile.ZipFile(zip_path, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)
    (destination / (zip_path.name + ".sha256")).write_text(
        hashlib.sha256(zip_path.read_bytes()).hexdigest() + "  " + zip_path.name + "\n", encoding="utf-8")
    print(zip_path)
    print("Verified: six reporters, accepted-task hooks, host networking, no private/runtime files.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    build(args.version, args.out.resolve())
