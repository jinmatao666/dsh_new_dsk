"""Unit tests for online WMS / MapServer overlay URL building."""
import json
import unittest
from unittest import mock

from online_service import (
    OnlineServiceError,
    arcgis_token_endpoint,
    bbox_intersects,
    build_overlay_image_url,
    fetch_overlay_image,
    normalize_arcgis_layers,
    resolve_arcgis_export_layers,
    transform_bbox,
    validate_crs,
    validate_service_url,
)


class OnlineServiceTests(unittest.TestCase):
    def test_build_wms_url(self):
        url = build_overlay_image_url(
            "https://example.com/geoserver/wms",
            "demo:layer",
            [120.0, 30.0, 121.0, 31.0],
            800,
            600,
            "EPSG:4326",
        )
        self.assertIn("REQUEST=GetMap", url)
        self.assertIn("LAYERS=demo%3Alayer", url)
        self.assertIn("BBOX=120.0%2C30.0%2C121.0%2C31.0", url)

    def test_build_arcgis_export_url(self):
        url = build_overlay_image_url(
            "https://example.com/arcgis/rest/services/City/MapServer",
            "3",
            [100.0, 20.0, 101.0, 21.0],
            640,
            480,
            "EPSG:4326",
            token="abc.token",
        )
        self.assertTrue(url.startswith("https://example.com/arcgis/rest/services/City/MapServer/export?"))
        self.assertIn("layers=show%3A3", url)
        self.assertIn("bboxSR=4326", url)
        self.assertIn("imageSR=4326", url)
        self.assertIn("f=image", url)
        self.assertIn("token=abc.token", url)

    def test_validate_crs_accepts_bare_code(self):
        self.assertEqual(validate_crs("4490"), "EPSG:4490")
        self.assertEqual(validate_crs("EPSG:4528"), "EPSG:4528")

    def test_normalize_arcgis_layers_requires_ids(self):
        self.assertEqual(normalize_arcgis_layers("0,1"), "show:0,1")
        self.assertEqual(normalize_arcgis_layers("show:2"), "show:2")
        with self.assertRaises(OnlineServiceError):
            normalize_arcgis_layers("红线图层")

    def test_resolve_group_layer_expands_children(self):
        metadata = {
            "layers": [
                {"id": 0, "name": "root", "subLayerIds": [1, 2]},
                {"id": 1, "name": "a", "subLayerIds": None},
                {"id": 2, "name": "b", "subLayerIds": None},
            ]
        }
        candidates = resolve_arcgis_export_layers("0", metadata)
        self.assertEqual(candidates[0], "show:0")
        self.assertEqual(candidates[1], "show:1,2")
        self.assertIn("", candidates)

    def test_transform_bbox_4528_to_4490(self):
        # Near zone-40 central meridian; result should be roughly lon 120 / lat 31.x
        bbox = transform_bbox([40526316.3755, 3494911.7267, 40527316.3755, 3495911.7267], "EPSG:4528", "EPSG:4490")
        self.assertTrue(119.5 < bbox[0] < 120.5)
        self.assertTrue(30.5 < bbox[1] < 32.5)

    def test_bbox_intersects_detects_north_offset(self):
        service = [40526077.0, 3391294.0, 40534367.0, 3400268.0]
        result = [40525700.0, 3494900.0, 40526400.0, 3495120.0]
        self.assertFalse(bbox_intersects(result, service))
        nearby = [40526100.0, 3395000.0, 40526200.0, 3396000.0]
        self.assertTrue(bbox_intersects(nearby, service))

    def test_arcgis_token_endpoint(self):
        self.assertEqual(
            arcgis_token_endpoint("http://60.191.110.206:36080/arcgis/rest/services/GD/QYZZ_GDBH/MapServer"),
            "http://60.191.110.206:36080/arcgis/tokens/generateToken",
        )

    def test_generate_token_prefers_referer_over_requestip(self):
        calls = []

        class FakeResponse:
            def __init__(self, payload):
                self._payload = payload

            def read(self, _size):
                return json.dumps(self._payload).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        def fake_urlopen(request, timeout=0):
            from urllib.parse import parse_qs
            body = request.data.decode() if isinstance(request.data, (bytes, bytearray)) else ""
            params = {key: values[0] for key, values in parse_qs(body).items()}
            calls.append(params.get("client"))
            if params.get("client") == "requestip":
                return FakeResponse({"error": {"code": 201, "message": "Exception in generating token", "details": "Client id cannot be determined"}})
            if params.get("client") == "referer":
                return FakeResponse({"token": "ok-token", "expires": 1})
            return FakeResponse({"error": {"message": "unexpected"}})

        with mock.patch("online_service.urllib.request.urlopen", side_effect=fake_urlopen):
            from online_service import generate_arcgis_token
            issued = generate_arcgis_token(
                "http://60.191.110.206:36080/arcgis/rest/services/GD/QYZZ_GDBH/MapServer",
                "demo",
                "secret",
            )
        self.assertEqual(issued["token"], "ok-token")
        self.assertEqual(issued["client"], "referer")
        self.assertEqual(calls[0], "referer")

    def test_rejects_localhost(self):
        with self.assertRaises(OnlineServiceError):
            validate_service_url("http://127.0.0.1:6080/arcgis/rest/services/x/MapServer")

    def test_fetch_rejects_html_error(self):
        class FakeResponse:
            headers = {"Content-Type": "text/html"}

            def read(self, _size):
                return b"<html>ServiceException</html>"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with mock.patch("online_service.urllib.request.urlopen", return_value=FakeResponse()):
            with mock.patch("online_service._hostname_allowed", return_value=True):
                with self.assertRaises(OnlineServiceError):
                    fetch_overlay_image(
                        "https://maps.example.com/wms",
                        "roads",
                        [1, 2, 3, 4],
                        256,
                        256,
                        "EPSG:4326",
                    )

    def test_fetch_mapserver_requires_token(self):
        with mock.patch("online_service._hostname_allowed", return_value=True):
            with self.assertRaisesRegex(OnlineServiceError, "Token"):
                fetch_overlay_image(
                    "http://60.191.110.206:36080/arcgis/rest/services/SL/SL_XZQ/MapServer",
                    "0",
                    [40525700.0, 3494900.0, 40526400.0, 3495120.0],
                    256,
                    256,
                    "EPSG:4528",
                )

    def test_fetch_rejects_token_required_text_plain(self):
        class FakeResponse:
            headers = {"Content-Type": "text/plain;charset=utf-8"}

            def read(self, _size):
                return b'{"error":{"code":499,"message":"Token Required","details":[]}}'

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with mock.patch("online_service.urllib.request.urlopen", return_value=FakeResponse()):
            with mock.patch("online_service._hostname_allowed", return_value=True):
                with mock.patch("online_service.fetch_mapserver_metadata", return_value={}):
                    with self.assertRaisesRegex(OnlineServiceError, "Token"):
                        fetch_overlay_image(
                            "http://60.191.110.206:36080/arcgis/rest/services/SL/SL_XZQ/MapServer",
                            "0",
                            [40525700.0, 3494900.0, 40526400.0, 3495120.0],
                            256,
                            256,
                            "EPSG:4528",
                            token="stale.token",
                        )


if __name__ == "__main__":
    unittest.main()
