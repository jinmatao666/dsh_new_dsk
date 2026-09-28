import os
from pathlib import Path
import unittest
from unittest.mock import patch

from deployment import checks, configured, local_asr_url, ready, valid_asr_url, valid_url


class DeploymentTests(unittest.TestCase):
    def test_build_downloads_use_overridable_mirrors_without_disabling_verification(self):
        dockerfile = Path(__file__).with_name("Dockerfile").read_text(encoding="utf-8")
        self.assertIn("ARG PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm", dockerfile)
        self.assertIn("FROM ${PYTHON_IMAGE}", dockerfile)
        self.assertIn("ARG DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn", dockerfile)
        self.assertIn("/etc/apt/sources.list.d/debian.sources", dockerfile)
        self.assertIn("ARG PIP_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple", dockerfile)
        self.assertIn('--index-url "${PIP_INDEX_URL}"', dockerfile)
        for bypass in ("--trusted-host", "--allow-unauthenticated", "Verify-Peer=false"):
            self.assertNotIn(bypass, dockerfile)
        self.assertLess(dockerfile.index("COPY requirements.txt"), dockerfile.index("COPY extract.py"))

    def test_compose_pins_the_port_used_by_its_loopback_mapping(self):
        compose = Path(__file__).with_name("compose.yml").read_text(encoding="utf-8")
        self.assertIn('      PORT: "4303"', compose)
        self.assertIn('"127.0.0.1:4303:4303"', compose)

    def test_urls_reject_secrets_placeholders_and_unsupported_origins(self):
        self.assertTrue(valid_url("https://expert.test", origin=True))
        self.assertTrue(valid_url("http://internal.test/analysis", internal=True))
        for value in ("http://expert.test", "https://x:y@expert.test", "https://expert.test?q=secret",
                      "https://expert.test#secret", "https://expert.test:bad", "https://x.example.com"):
            self.assertFalse(valid_url(value))
        self.assertFalse(valid_url("https://expert.test/path", origin=True))

    def test_local_xinference_asr_only_accepts_loopback_transcription_endpoint(self):
        endpoint = "http://127.0.0.1:20330/v1/audio/transcriptions"
        self.assertTrue(local_asr_url(endpoint))
        self.assertTrue(valid_asr_url(endpoint))
        self.assertTrue(valid_asr_url("https://asr.test/v1/audio/transcriptions"))
        for value in ("http://host.docker.internal:20330/v1/audio/transcriptions",
                      "http://127.0.0.1:20330/v1/models", "http://127.0.0.1:20330/v1/audio/transcriptions?token=x",
                      "http://user:secret@127.0.0.1:20330/v1/audio/transcriptions"):
            self.assertFalse(valid_asr_url(value))
        with patch.dict(os.environ, {"EXPERT_ASR_URL": endpoint, "EXPERT_ASR_MODEL": "Qwen3-ASR-1.7B"}, clear=True):
            self.assertTrue(checks()["asr_url"])
            self.assertTrue(checks()["asr_id"])
            self.assertTrue(checks()["asr_key"])

    def test_same_host_compose_does_not_publish_ports(self):
        root = Path(__file__).parent
        compose = (root / "compose.local-xinference.yml").read_text(encoding="utf-8")
        example = (root / ".env.xinference-local.example").read_text(encoding="utf-8")
        self.assertIn("network_mode: host", compose)
        self.assertIn("HOST: 127.0.0.1", compose)
        self.assertNotIn("ports:", compose)
        self.assertIn("EXPERT_ASR_URL=http://127.0.0.1:20330/v1/audio/transcriptions", example)
        self.assertIn("EXPERT_ASR_MODEL=Qwen3-ASR-1.7B", example)

    def test_unconfigured_is_not_ready_and_checks_do_not_disclose_values(self):
        with patch.dict(os.environ, {"EXPERT_PROVIDER_CREDENTIAL": "private-secret-value"}, clear=True):
            self.assertTrue(configured("EXPERT_PROVIDER_CREDENTIAL"))
            self.assertFalse(ready())
            self.assertNotIn("private-secret-value", repr(checks()))
        with patch.dict(os.environ, {"EXPERT_PROVIDER_CREDENTIAL": "replace-with-key"}, clear=True):
            self.assertFalse(configured("EXPERT_PROVIDER_CREDENTIAL"))


if __name__ == "__main__":
    unittest.main()
