"""Unit tests for overlay Shapefile / GeoJSON parsing."""
import base64
import io
import json
import unittest
import zipfile

import shapefile

from overlay import OverlayError, parse_overlay_files


def _shape_zip():
    shp = io.BytesIO()
    shx = io.BytesIO()
    dbf = io.BytesIO()
    writer = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON)
    writer.field("NAME", "C", 32)
    writer.poly([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]])
    writer.record("demo")
    writer.close()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("demo.shp", shp.getvalue())
        zipped.writestr("demo.shx", shx.getvalue())
        zipped.writestr("demo.dbf", dbf.getvalue())
    return archive.getvalue()


class OverlayTests(unittest.TestCase):
    def test_parse_shapefile_zip(self):
        payload = base64.b64encode(_shape_zip()).decode()
        collection = parse_overlay_files([{"name": "demo.zip", "content": payload}])
        self.assertEqual(collection["type"], "FeatureCollection")
        self.assertEqual(collection["count"], 1)
        self.assertEqual(collection["features"][0]["geometry"]["type"], "Polygon")
        self.assertEqual(collection["features"][0]["properties"]["NAME"], "demo")

    def test_parse_geojson(self):
        body = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {"layer": "红线"},
                "geometry": {"type": "Polygon", "coordinates": [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]},
            }],
        }
        payload = base64.b64encode(json.dumps(body).encode()).decode()
        collection = parse_overlay_files([{"name": "out.geojson", "content": payload}])
        self.assertEqual(collection["count"], 1)
        self.assertEqual(collection["features"][0]["properties"]["layer"], "红线")

    def test_rejects_path_traversal_name(self):
        with self.assertRaises(OverlayError):
            parse_overlay_files([{"name": "../x.zip", "content": base64.b64encode(b"PK").decode()}])


if __name__ == "__main__":
    unittest.main()
