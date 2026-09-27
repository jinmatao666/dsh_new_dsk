"""Model protocol fixtures verify grounding and failure, not production model quality."""
import io
import json
import unittest
from unittest.mock import patch
from interpretation import interpret, RULES
from geometry import SpatialError


class InterpretationTests(unittest.TestCase):
    def test_request_contains_current_records_and_expert_rules(self):
        received = []
        class Opener:
            def open(self, request, timeout):
                received.append(request)
                return io.BytesIO(json.dumps({"choices": [{"finish_reason": "stop",
                    "message": {"content": "## 综合结论\n仅测试协议正文。"}}]}).encode())
        with patch.dict("os.environ", {"EXPERT_MODEL_URL": "https://model.test/chat",
                                      "EXPERT_MODEL": "test-model", "EXPERT_MODEL_KEY": "test-key"}):
            with patch("interpretation.urllib.request.build_opener", return_value=Opener()):
                text = interpret("测试专家", "本次项目", {"year": "2024"},
                                 {"图层": [{"面积": 12.5}]})
        payload = json.loads(received[0].data)
        self.assertIn(RULES, payload["messages"][0]["content"])
        self.assertIn("12.5", payload["messages"][1]["content"])
        self.assertIn("本次项目", payload["messages"][1]["content"])
        self.assertIn("综合结论", text)
        self.assertNotIn("test-key", received[0].data.decode())

    def test_missing_configuration_and_excess_data_do_not_call_model(self):
        with patch.dict("os.environ", {"EXPERT_MODEL_URL": "", "EXPERT_MODEL": "", "EXPERT_MODEL_KEY": ""}):
            with self.assertRaisesRegex(SpatialError, "尚未配置"):
                interpret("专家", "项目", {}, {})
        with patch.dict("os.environ", {"EXPERT_MODEL_URL": "https://model.test/chat",
                                      "EXPERT_MODEL": "model", "EXPERT_MODEL_KEY": "key"}):
            with patch("interpretation.urllib.request.build_opener") as opener:
                with self.assertRaisesRegex(SpatialError, "不会静默截断"):
                    interpret("专家", "项目", {}, {"数据": "文" * 60001})
                opener.assert_not_called()

    def test_truncated_and_empty_results_are_not_success(self):
        class Opener:
            def __init__(self, choice):
                self.choice = choice
            def open(self, request, timeout):
                return io.BytesIO(json.dumps({"choices": [self.choice]}).encode())
        with patch.dict("os.environ", {"EXPERT_MODEL_URL": "https://model.test/chat",
                                      "EXPERT_MODEL": "model", "EXPERT_MODEL_KEY": "key"}):
            for choice in ({"finish_reason": "length", "message": {"content": "不完整"}},
                           {"finish_reason": "stop", "message": {"content": ""}}):
                with patch("interpretation.urllib.request.build_opener", return_value=Opener(choice)):
                    with self.assertRaises(SpatialError):
                        interpret("专家", "项目", {}, {})


if __name__ == "__main__":
    unittest.main()
