"""Verify the local Xinference request without contacting the user's server."""
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from audio import transcribe_chunk
from extract import DocumentError
from model import generate


class AudioConfigTests(unittest.TestCase):
    def test_local_xinference_text_model_sends_uid_and_returns_minutes(self):
        requests = []

        class FakeOpener:
            def open(self, request, timeout):
                requests.append(request)
                return io.BytesIO(json.dumps({"choices": [{"message": {"content": "会议纪要正文"}, "finish_reason": "stop"}]}).encode())

        with patch.dict(os.environ, {
            "EXPERT_MODEL_URL": "http://127.0.0.1:20330/v1/chat/completions",
            "EXPERT_MODEL": "qwen3.8-27b-fp8",
        }, clear=True), patch("model.urllib.request.build_opener", return_value=FakeOpener()):
            self.assertEqual(generate("会议材料"), "会议纪要正文")
        self.assertEqual(json.loads(requests[0].data)["model"], "qwen3.8-27b-fp8")
        self.assertFalse(requests[0].has_header("Authorization"))

    def test_text_model_rejects_remote_http_and_wrong_local_path(self):
        for endpoint in ("http://remote.test/v1/chat/completions", "http://127.0.0.1:20330/v1/models"):
            with patch.dict(os.environ, {"EXPERT_MODEL_URL": endpoint, "EXPERT_MODEL": "qwen3.8-27b-fp8"}, clear=True):
                with self.assertRaisesRegex(DocumentError, "尚未配置"):
                    generate("会议材料")

    def test_local_xinference_without_auth_sends_model_and_audio(self):
        requests = []

        class FakeOpener:
            def open(self, request, timeout):
                requests.append(request)
                return io.BytesIO(b'{"text":"\xe4\xbc\x9a\xe8\xae\xae\xe7\xba\xaa\xe8\xa6\x81"}')

        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "segment.wav"
            audio.write_bytes(b"RIFFtest")
            with patch.dict(os.environ, {
                "EXPERT_ASR_URL": "http://127.0.0.1:20330/v1/audio/transcriptions",
                "EXPERT_ASR_MODEL": "Qwen3-ASR-1.7B",
                "EXPERT_ASR_PROTOCOL": "multipart",
            }, clear=True), patch("audio.urllib.request.build_opener", return_value=FakeOpener()):
                self.assertEqual(transcribe_chunk(audio), "会议纪要")
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].full_url, "http://127.0.0.1:20330/v1/audio/transcriptions")
        self.assertIn(b"Qwen3-ASR-1.7B", requests[0].data)
        self.assertIn(b"RIFFtest", requests[0].data)
        self.assertFalse(requests[0].has_header("Authorization"))

    def test_non_loopback_http_asr_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "segment.wav"
            audio.write_bytes(b"RIFFtest")
            with patch.dict(os.environ, {
                "EXPERT_ASR_URL": "http://xinference.example.test:20330/v1/audio/transcriptions",
                "EXPERT_ASR_MODEL": "Qwen3-ASR-1.7B",
            }, clear=True):
                with self.assertRaisesRegex(DocumentError, "尚未配置"):
                    transcribe_chunk(audio)


if __name__ == "__main__":
    unittest.main()
