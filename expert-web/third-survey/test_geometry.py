import json
from pathlib import Path
import struct
import tempfile
import unittest
from geometry import read_dataset, shape_rings, validate_rings, SpatialError


RING = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]


def shape_fixture():
    content = struct.pack("<i4d2ii", 5, 0, 0, 10, 10, 1, 5, 0) + b"".join(struct.pack("<2d", *point) for point in RING)
    header = bytearray(100)
    struct.pack_into(">i", header, 0, 9994)
    struct.pack_into(">i", header, 24, (108 + len(content)) // 2)
    struct.pack_into("<ii", header, 28, 1000, 5)
    return bytes(header) + struct.pack(">ii", 1, len(content) // 2) + content


class GeometryTests(unittest.TestCase):
    def test_geojson_and_shape_coordinates_are_preserved(self):
        self.assertEqual(shape_rings(shape_fixture()), [RING])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "范围.geojson"
            path.write_text(json.dumps({"type": "Polygon", "coordinates": [RING]}), encoding="utf-8")
            self.assertEqual(read_dataset([path])[0], [RING])

    def test_invalid_coordinates_and_truncated_shape(self):
        for rings in ([], [[[0, 0], [0, 1], [1, 1], [1, 0]]], [[[0, 0], [0, 1], [float("nan"), 1], [0, 0]]]):
            with self.assertRaises(SpatialError):
                validate_rings(rings)
        with self.assertRaises(SpatialError):
            shape_rings(shape_fixture()[:-1])


if __name__ == "__main__":
    unittest.main()
