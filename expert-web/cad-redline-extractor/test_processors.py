import csv
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import ezdxf

from processors import (
    ConversionError,
    convert,
    convert_dwg_to_dxf,
    decode_cad_layer_name,
    decode_esri_shape,
    export_personal_geodatabase,
    find_dataset,
    layer_matches,
    unzip_archive,
)
import struct


class ProcessorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_epsg_coordinate_transform_exports_csv(self):
        source = self.root / "points.csv"
        source.write_text("id,x,y\n1,120.0,30.0\n", encoding="utf-8")
        output = self.root / "out-epsg"
        paths = convert("coordinate-transform", [source], output, {
            "method": "epsg", "sourceEpsg": "4326", "targetEpsg": "4547",
            "xField": "x", "yField": "y",
        })
        self.assertEqual(len(paths), 1)
        with paths[0].open(encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(float(rows[0]["x"]), 120.0)
        self.assertNotAlmostEqual(float(rows[0]["x_out"]), 120.0)

    def test_four_param_identity_keeps_values(self):
        source = self.root / "plain.csv"
        source.write_text("x,y\n100,200\n", encoding="utf-8")
        output = self.root / "out-four"
        paths = convert("coordinate-transform", [source], output, {
            "method": "four-param", "dx": "0", "dy": "0", "rotation": "0", "scale": "0",
            "xField": "x", "yField": "y",
        })
        with paths[0].open(encoding="utf-8-sig") as handle:
            row = next(csv.DictReader(handle))
        self.assertAlmostEqual(float(row["x_out"]), 100.0)
        self.assertAlmostEqual(float(row["y_out"]), 200.0)

    def test_redline_extract_from_dxf_geojson(self):
        dxf = self.root / "site.dxf"
        document = ezdxf.new()
        document.layers.add("规划红线")
        model = document.modelspace()
        model.add_lwpolyline([(0, 0), (10, 0), (10, 8), (0, 8)], close=True, dxfattribs={"layer": "规划红线"})
        document.saveas(dxf)
        output = self.root / "out-redline"
        paths = convert("redline-extract", [dxf], output, {"exportFormat": "both"})
        self.assertEqual(len(paths), 2)
        geojson = json.loads(paths[0].read_text(encoding="utf-8"))
        self.assertEqual(geojson["type"], "FeatureCollection")
        self.assertEqual(len(geojson["features"]), 1)
        self.assertTrue(paths[1].name.endswith(".zip"))

    def test_redline_missing_layer_fails_clearly(self):
        dxf = self.root / "empty.dxf"
        ezdxf.new().saveas(dxf)
        with self.assertRaises(ConversionError):
            convert("redline-extract", [dxf], self.root / "out-miss", {"layer": "不存在"})

    def test_decode_oda_mif_layer_name_and_match(self):
        # ODA DXF escape for 可建设用地范围线 (GBK bytes after \\M+5).
        encoded = (
            r"\M+5BFC9\M+5BDA8\M+5C9E8\M+5D3C3"
            r"\M+5B5D8\M+5B7B6\M+5CEA7\M+5CFDF"
        )
        self.assertEqual(decode_cad_layer_name(encoded), "可建设用地范围线")
        self.assertTrue(layer_matches(encoded, ""))
        self.assertTrue(layer_matches(encoded, "可建设范围线"))
        self.assertTrue(layer_matches(encoded, "可建设用地范围线"))

    def test_redline_extract_oda_encoded_layer(self):
        encoded = (
            r"\M+5BFC9\M+5BDA8\M+5C9E8\M+5D3C3"
            r"\M+5B5D8\M+5B7B6\M+5CEA7\M+5CFDF"
        )
        dxf = self.root / "encoded.dxf"
        document = ezdxf.new()
        document.layers.add(encoded)
        document.modelspace().add_lwpolyline(
            [(0, 0), (4, 0), (4, 3), (0, 3)], close=True, dxfattribs={"layer": encoded})
        document.saveas(dxf)
        paths = convert("redline-extract", [dxf], self.root / "out-enc", {"exportFormat": "geojson"})
        geojson = json.loads(paths[0].read_text(encoding="utf-8"))
        self.assertEqual(geojson["features"][0]["properties"]["layer"], "可建设用地范围线")

    def test_find_dataset_returns_directory_for_multiple_shapefiles(self):
        folder = self.root / "layers"
        folder.mkdir()
        for name in ("alpha", "beta"):
            (folder / f"{name}.shp").write_bytes(b"\x00" * 100)
            (folder / f"{name}.shx").write_bytes(b"\x00" * 20)
            (folder / f"{name}.dbf").write_bytes(b"\x00" * 20)
        kind, path = find_dataset(folder)
        self.assertEqual(kind, "shp")
        self.assertEqual(path.resolve(), folder.resolve())

    def test_find_dataset_accepts_named_gdb_folder(self):
        gdb = self.root / "parcel.gdb"
        gdb.mkdir()
        (gdb / "gdb").write_text("", encoding="utf-8")
        (gdb / "a00000001.gdbtable").write_bytes(b"x")
        kind, path = find_dataset(self.root)
        self.assertEqual(kind, "gdb")
        self.assertEqual(path, gdb)

    def test_find_dataset_ignores_empty_named_gdb_directory(self):
        empty = self.root / "empty.gdb"
        empty.mkdir()
        real = self.root / "nested"
        real.mkdir()
        (real / "gdb").write_text("", encoding="utf-8")
        (real / "a00000001.gdbtable").write_bytes(b"x")
        kind, path = find_dataset(self.root)
        self.assertEqual(kind, "gdb")
        self.assertEqual(path, real)

    def test_find_dataset_accepts_zipped_gdb_contents_without_folder_suffix(self):
        payload = self.root / "flat"
        payload.mkdir()
        (payload / "gdb").write_text("", encoding="utf-8")
        (payload / "a00000001.gdbtable").write_bytes(b"x")
        (payload / "a00000001.gdbtablx").write_bytes(b"x")
        archive = self.root / "flat-gdb.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            for file in payload.iterdir():
                bundle.write(file, file.name)
        extracted = unzip_archive(archive, self.root / "extracted")
        kind, path = find_dataset(extracted)
        self.assertEqual(kind, "gdb")
        self.assertTrue((path / "a00000001.gdbtable").is_file())

    def test_format_convert_rejects_same_format_and_missing_ogr(self):
        source = self.root / "drawing.dxf"
        ezdxf.new().saveas(source)
        with self.assertRaises(ConversionError):
            convert("format-convert", [source], self.root / "out-fmt", {"targetFormat": "dxf"})

    def test_format_convert_dxf_to_shapefile_when_ogr_available(self):
        import shutil
        from processors import configure_gdal_environment
        if not configure_gdal_environment() and not shutil.which("ogr2ogr"):
            self.skipTest("ogr2ogr unavailable")
        document = ezdxf.new()
        document.modelspace().add_lwpolyline([(0, 0), (5, 0), (5, 5), (0, 5)], close=True)
        source = self.root / "parcel.dxf"
        document.saveas(source)
        paths = convert("format-convert", [source], self.root / "out-dxf-shp", {"targetFormat": "shp"})
        self.assertEqual(len(paths), 1)
        self.assertTrue(paths[0].name.endswith(".zip"))
        self.assertGreater(paths[0].stat().st_size, 0)

    def test_decode_esri_polygon_shape_buffer(self):
        points = [(0.0, 0.0), (10.0, 0.0), (10.0, 8.0), (0.0, 8.0), (0.0, 0.0)]
        payload = struct.pack("<i", 5)
        payload += struct.pack("<4d", 0.0, 0.0, 10.0, 8.0)
        payload += struct.pack("<2i", 1, len(points))
        payload += struct.pack("<i", 0)
        for x, y in points:
            payload += struct.pack("<2d", x, y)
        decoded = decode_esri_shape(payload)
        self.assertEqual(decoded["kind"], "polygon")
        self.assertEqual(decoded["parts"], [0])
        self.assertEqual(len(decoded["points"]), 5)

    def test_export_personal_geodatabase_when_sample_present(self):
        sample = Path(__file__).resolve().parent / "tmp" / "sample.mdb"
        if not sample.is_file():
            self.skipTest("sample Personal GDB not present")
        destination = self.root / "mdb-shp"
        export_personal_geodatabase(sample, destination)
        layers = list(destination.glob("*.shp"))
        self.assertGreaterEqual(len(layers), 1)
        paths = convert("format-convert", [sample], self.root / "out-mdb-shp", {"targetFormat": "shp"})
        self.assertEqual(len(paths), 1)
        self.assertTrue(paths[0].name.endswith(".zip"))

    def test_dwg_without_oda_mentions_missing_oda_environment(self):
        source = self.root / "sample.dwg"
        source.write_bytes(b"AC1018" + b"\x00" * 64)
        destination = self.root / "out.dxf"

        def fake_run(command, timeout=120, open_hint=None):
            name = Path(command[0]).name.lower()
            if "dwg2dxf" in name:
                raise ConversionError("LibreDWG 转换失败")
            if "ogr2ogr" in name:
                raise ConversionError("GDAL 无法打开该 DWG（仅支持部分旧版 CAD）。")
            raise ConversionError(f"unexpected command: {command}")

        with patch("processors.configure_dwg_tools", return_value="dwg2dxf"), \
             patch("processors.configure_oda_converter", return_value=None), \
             patch("processors.which_tool", side_effect=lambda name: "ogr2ogr" if name == "ogr2ogr" else None), \
             patch("processors.run_checked", side_effect=fake_run):
            with self.assertRaises(ConversionError) as raised:
                convert_dwg_to_dxf(source, destination)
        message = str(raised.exception)
        self.assertIn("没有 ODA", message)
        self.assertIn("LibreDWG", message)
        self.assertIn("GDAL", message)


if __name__ == "__main__":
    unittest.main()
