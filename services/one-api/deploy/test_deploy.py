"""Offline verification for delivery operations; Docker calls are isolated."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import deploy


class DeliveryTests(unittest.TestCase):
    def test_template_cannot_overwrite_local_config(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            deploy.write_private(path, "SESSION_SECRET=site-owned\n")
            with self.assertRaises(FileExistsError):
                deploy.write_private(path, "template\n")
            self.assertEqual(path.read_text(), "SESSION_SECRET=site-owned\n")

    def test_only_image_changes_including_quotes_and_secrets(self):
        source = "# local\nDSH_IMAGE=local/app:1-amd64\nSQL_DSN='postgres://local/oneapi'\nSESSION_SECRET=keep$me\nDSH_API_PREFIX=/unit/api\n"
        result = deploy.replace_image(source, "local/app:2-amd64")
        self.assertEqual(result.replace("2-amd64", "1-amd64"), source)
        for invalid in ("latest", "app:latest", "app", "REGISTRY/app:SET_VERSION", "app:1\nDSH_API_PREFIX=/bad"):
            with self.assertRaises(ValueError): deploy.replace_image(source, invalid)

    def test_candidate_preflight_uses_resolved_environment_and_no_network(self):
        service = {"image": "local/app:2-amd64", "platform": "linux/amd64", "environment": {"SESSION_SECRET": "quoted$secret", "DSH_PUBLIC_URL": "https://unit.example/api", "EMPTY": ""}}
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            if args[1] == "image": return json.dumps([{"Os": "linux", "Architecture": "amd64"}])
            path = Path(args[args.index("--env-file") + 1])
            self.assertIn("SESSION_SECRET=quoted$secret\n", path.read_text())
            self.assertEqual(args[args.index("--network") + 1], "none")
            self.assertNotIn("quoted$secret", " ".join(args))
            self.assertNotIn("--volume", args)
            self.assertEqual(args[-1], "--check-deployment")

        with patch.object(deploy, "configuration", return_value=(service, {})), patch.object(deploy, "run", side_effect=run):
            deploy.check("local/app:2-amd64")
        self.assertEqual(len(calls), 2)
        self.assertFalse(Path(calls[-1][calls[-1].index("--env-file") + 1]).exists())

    def test_update_preserves_site_configuration_and_retains_backup(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "ROOT", Path(directory)), patch.object(deploy, "check"), patch.object(deploy, "compose") as compose:
            path = Path(directory) / ".env"
            content = "DSH_IMAGE=local/app:1-amd64\nSESSION_SECRET=keep\nDSH_API_PREFIX=/site/api\n"
            path.write_text(content)
            deploy.update("local/app:2-amd64")
            self.assertEqual(path.read_text(), content.replace("1-amd64", "2-amd64"))
            backup, = Path(directory).glob(".env.before-image-*")
            self.assertEqual(backup.read_text(), content)
            args = compose.call_args.args
            self.assertIn("--no-build", args)
            self.assertIn("never", args)
            self.assertNotIn("down", args)

    def test_architecture_mismatch_stops_before_any_container_start(self):
        service = {"image": "local/app:1-arm64", "platform": "linux/arm64", "environment": {}}
        with patch.object(deploy, "configuration", return_value=(service, {})), patch.object(deploy, "run", return_value=json.dumps([{"Os": "linux", "Architecture": "amd64"}])) as run:
            with self.assertRaisesRegex(ValueError, "architecture"):
                deploy.check()
            self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
