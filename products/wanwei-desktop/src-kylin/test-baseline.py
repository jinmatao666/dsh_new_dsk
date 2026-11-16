"""Exercise compatibility audit rejection paths without requiring new toolchains."""
import importlib.util
import pathlib
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("baseline", pathlib.Path(__file__).with_name("check-baseline.py"))
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
installer_spec = importlib.util.spec_from_file_location("installers", pathlib.Path(__file__).with_name("check-installers.py"))
installers = importlib.util.module_from_spec(installer_spec)
installer_spec.loader.exec_module(installers)


class BaselineTests(unittest.TestCase):
    def test_rejects_bundlers_default_ayatana_dependency(self):
        expected = "libwebkit2gtk-4.0-37, libgtk-3-0, libappindicator3-1"
        installers.check_depends(expected)
        for extra in [", libayatana-appindicator3-1", ", libwebkit2gtk-4.1-0", ", libsoup-3.0-0"]:
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "metadata"):
                installers.check_depends(expected + extra)

    def inspect(self, needs="GLIBC_2.31", linked="libc.so.6 => /lib/libc.so.6", code=0, arch="x64"):
        headers = ["Machine: Advanced Micro Devices X86-64", "Version needs section:\n Name: " + needs]
        with patch.object(subprocess, "check_output", side_effect=headers), patch.object(
            subprocess, "run", return_value=subprocess.CompletedProcess([], code, linked)
        ):
            return baseline.inspect(pathlib.Path("/fixture/app"), arch)

    def test_ignores_versions_defined_by_bundled_library(self):
        output = "Version definition section:\n Name: GLIBC_2.99\nVersion needs section:\n Name: GLIBC_2.31"
        self.assertEqual(baseline.requirements(output), [("GLIBC", (2, 31))])

    def test_accepts_target_floor_and_static_binaries(self):
        self.assertEqual(self.inspect()["GLIBC"], "2.31")
        self.inspect(linked="not a dynamic executable", code=1)

    def test_rejects_newer_runtime_symbols(self):
        for version in ["GLIBC_2.32", "GLIBCXX_3.4.29", "CXXABI_1.3.13"]:
            with self.subTest(version=version), self.assertRaisesRegex(RuntimeError, "requires"):
                self.inspect(needs=version)

    def test_rejects_foreign_architecture(self):
        with self.assertRaisesRegex(RuntimeError, "architecture"):
            self.inspect(arch="arm64")

    def test_rejects_missing_or_incompatible_libraries(self):
        for linked in ["libfoo.so => not found", "libwebkit2gtk-4.1.so.0", "libsoup-3.0.so.0"]:
            with self.subTest(linked=linked), self.assertRaises(RuntimeError):
                self.inspect(linked=linked)
        with self.assertRaisesRegex(RuntimeError, "inspection failed"):
            self.inspect(linked="ldd failed unexpectedly", code=1)


if __name__ == "__main__":
    unittest.main()
