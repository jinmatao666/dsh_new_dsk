"""Normalize local uploads and transcribe bounded WAV segments through a configured service."""
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import urllib.request
from urllib.parse import urlsplit
import wave

from extract import DocumentError
from model import NoRedirect


def transcribe_chunk(path):
    endpoint, model, key = [os.environ.get(name, "") for name in ("EXPERT_ASR_URL", "EXPERT_ASR_MODEL", "EXPERT_ASR_KEY")]
    protocol = os.environ.get("EXPERT_ASR_PROTOCOL", "multipart")
    if urlsplit(endpoint).scheme != "https" or not model or not key:
        raise DocumentError("专家服务端尚未配置录音转写服务")
    data = Path(path).read_bytes()
    if protocol == "dashscope":
        payload = json.dumps({"model": model, "input": {"messages": [{"role": "user", "content": [
            {"type": "input_audio", "input_audio": {"data": "data:audio/wav;base64," + base64.b64encode(data).decode()}}]}]},
            "parameters": {"format": "wav", "sample_rate": "16000"}}).encode()
        content_type = "application/json"
    elif protocol == "multipart":
        boundary = "----expert" + secrets.token_hex(16)
        payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{model}\r\n'
                   f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="segment.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + data + f"\r\n--{boundary}--\r\n".encode()
        content_type = f"multipart/form-data; boundary={boundary}"
    else:
        raise DocumentError("转写协议必须为 multipart 或 dashscope")
    request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": content_type,
                                      "Authorization": f"Bearer {key}", "X-DashScope-SSE": "disable"})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=90) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError("oversized transcript")
            result = json.loads(raw)
        if protocol == "dashscope":
            if result.get("code"):
                raise ValueError("provider failure")
            text = result.get("output", {}).get("text") or result.get("output", {}).get("sentence", {}).get("text")
        else:
            text = result.get("text") or result.get("data", {}).get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("missing transcript")
        return text.strip()
    except (OSError, ValueError, TypeError, AttributeError):
        raise DocumentError("录音转写服务失败，未生成替代转写内容") from None


def transcribe_audio(source, task_directory, transcriber=transcribe_chunk):
    executable = shutil.which("ffmpeg")
    if not executable:
        raise DocumentError("服务端未安装 FFmpeg，无法处理录音")
    with tempfile.TemporaryDirectory(prefix="audio-", dir=task_directory) as temp:
        root = Path(temp)
        normalized = root / "normalized.wav"
        env = {key: value for key, value in os.environ.items()
               if not any(part in key.upper() for part in ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"))}
        result = subprocess.run([executable, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                                 "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(normalized)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, check=False)
        if result.returncode != 0 or not normalized.exists():
            raise DocumentError("录音无法解码，请检查格式和文件是否损坏")
        texts = []
        with wave.open(str(normalized), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
            if duration <= 0 or duration > 3600:
                raise DocumentError("录音须在 0–60 分钟之间；不会截断超长录音")
            params = audio.getparams()
            number = 0
            while frames := audio.readframes(audio.getframerate() * 120):
                number += 1
                segment = root / "segment.wav"
                with wave.open(str(segment), "wb") as chunk:
                    chunk.setparams(params)
                    chunk.writeframes(frames)
                try:
                    texts.append(transcriber(segment))
                except DocumentError:
                    raise DocumentError(f"录音第 {number} 段转写失败，请重新提交；不发布不完整纪要") from None
        return "\n\n".join(texts)
