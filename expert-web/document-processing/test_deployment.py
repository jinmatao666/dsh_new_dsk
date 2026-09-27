import os
from pathlib import Path
import unittest
from unittest.mock import patch

from deployment import checks, configured, ready, valid_url


class DeploymentTests(unittest.TestCase):
    def test_compose_pins_the_port_used_by_its_loopback_mapping(self):
        compose = Path(__file__).with_name("compose.yml").read_text(encoding="utf-8")
        self.assertIn('      PORT: "4302"', compose)
        self.assertIn('"127.0.0.1:4302:4302"', compose)

    def test_urls_reject_secrets_placeholders_and_unsupported_origins(self):
        self.assertTrue(valid_url("https://expert.test", origin=True))
        self.assertTrue(valid_url("http://internal.test/analysis", internal=True))
        for value in ("http://expert.test", "https://x:y@expert.test", "https://expert.test?q=secret",
                      "https://expert.test#secret", "https://expert.test:bad", "https://x.example.com"):
            self.assertFalse(valid_url(value))
        self.assertFalse(valid_url("https://expert.test/path", origin=True))

    def test_unconfigured_is_not_ready_and_checks_do_not_disclose_values(self):
        with patch.dict(os.environ, {"EXPERT_PROVIDER_CREDENTIAL": "private-secret-value"}, clear=True):
            self.assertTrue(configured("EXPERT_PROVIDER_CREDENTIAL"))
            self.assertFalse(ready())
            self.assertNotIn("private-secret-value", repr(checks()))
        with patch.dict(os.environ, {"EXPERT_PROVIDER_CREDENTIAL": "replace-with-key"}, clear=True):
            self.assertFalse(configured("EXPERT_PROVIDER_CREDENTIAL"))


if __name__ == "__main__":
    unittest.main()
