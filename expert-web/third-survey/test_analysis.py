import unittest
import json
import tempfile
from pathlib import Path
from analysis import analyze, request_payload, normalize_response, DATASETS
from geometry import SpatialError
from test_geometry import RING

class AnalysisTests(unittest.TestCase):
    def test_model_failure_does_not_publish_partial_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "range.json"
            source.write_text(json.dumps({"type": "Polygon", "coordinates": [RING]}), encoding="utf-8")
            from analysis import DATASETS
            def failed(*args):
                raise SpatialError("解读失败")
            with self.assertRaisesRegex(SpatialError, "解读失败"):
                analyze([source], root / "output", requester=lambda _: {key: [] for key in DATASETS},
                        interpreter=failed)
            self.assertFalse((root / "output").exists())

    def test_explicit_integer_option_reaches_service_unchanged(self):
        for value in (2000, 2100, "2000", " 2100 "):
            with self.subTest(value=value):
                self.assertEqual(request_payload([RING], {"year": value})["Xznf"], int(value))

    def test_invalid_option_is_not_truncated_or_defaulted(self):
        for value in (True, False, None, [], {}, 4.5, "2000.5", "", " ", 1999, 2101):
            with self.subTest(value=value):
                with self.assertRaises(SpatialError):
                    request_payload([RING], {"year": value})

    def test_service_specific_payload(self):
        payload = request_payload([RING], {})
        self.assertFalse(payload["IsAnaXzCoverBp"])
        self.assertEqual(payload["Xznf"], 2024)
        self.assertTrue(payload["IsAnaXz"])

    def test_expected_datasets_only(self):
        response = {key: [] for key in DATASETS}
        self.assertEqual(normalize_response(response), response)
        with self.assertRaises(SpatialError):
            normalize_response({"error": "not an analysis"})

if __name__ == "__main__":
    unittest.main()
