import json
import unittest
from unittest.mock import patch, MagicMock

from server import report_usage


class UsageReportingTests(unittest.TestCase):
    def test_started_task_reports_redeemed_user_with_stable_event_id(self):
        opener = MagicMock()
        response = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch.dict("os.environ", {
            "EXPERT_PLATFORM_REDEEM_URL": "https://platform.example/api/expert-web/redeem",
            "EXPERT_PROVIDER_CREDENTIAL": "provider-secret",
        }), patch("server.urllib.request.build_opener", return_value=opener):
            report_usage("7", "abc123")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://platform.example/api/expert-web/usage")
        self.assertEqual(json.loads(request.data), {"event_id": "expert-task-abc123", "user_id": 7})
        self.assertEqual(request.get_header("Authorization"), "Bearer provider-secret")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 5)


if __name__ == "__main__":
    unittest.main()
