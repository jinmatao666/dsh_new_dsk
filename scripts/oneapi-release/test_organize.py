"""Offline checks for legacy-path migration; production files and Docker are never touched."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('organize_oneapi', Path(__file__).with_name('organize-oneapi.py'))
organize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(organize)


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def test_plan_and_apply_leave_mounted_data_and_unrelated_services_in_place(self):
        for name in ('dsh-one-api-build.Abcd', 'dsh-one-api-update.Abcd', 'dsh-gateway-tunnel.Abcd', 'dsh-experts', 'model'):
            (self.root / name).mkdir()
        source = self.root / 'dsh-one-api-0.0.87-config.private.json'
        source.write_text('private fixture', encoding='utf-8')
        live = self.root / 'dsh/data/one-api-updates.live'
        live.mkdir(parents=True)
        (live / 'installer.zip').write_bytes(b'existing update')
        moves = organize.plan(self.root, [str(live)])
        self.assertEqual(len(moves), 4)
        self.assertTrue(source.exists())  # check mode never moves anything.
        journal = organize.apply(moves, self.root / 'dsh')
        self.assertTrue(Path(journal).exists())
        self.assertEqual((live / 'installer.zip').read_bytes(), b'existing update')
        self.assertTrue((self.root / 'dsh-experts').exists())
        self.assertTrue((self.root / 'model').exists())
        self.assertEqual((self.root / 'dsh/backups/migrations' / source.name).read_text(), 'private fixture')
        self.assertEqual(organize.plan(self.root, [str(live)]), [])

    def test_rejects_mounts_and_collisions_before_any_move(self):
        source = self.root / 'dsh-one-api-update.Abcd'
        source.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'Container mount'):
            organize.plan(self.root, [str(source / 'nested')])
        dest = self.root / 'dsh/updates' / source.name
        dest.mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            organize.plan(self.root, [])
        self.assertTrue(source.exists())

    def test_reverses_completed_moves_after_rename_failure(self):
        first = self.root / 'dsh-one-api-build.Abcd'
        second = self.root / 'dsh-one-api-update.Abcd'
        first.mkdir()
        second.mkdir()
        moves = organize.plan(self.root, [])
        rename = Path.rename
        def guarded(path, target):
            if path == second:
                raise OSError('fixture rename failure')
            return rename(path, target)
        with patch.object(Path, 'rename', guarded), self.assertRaises(OSError):
            organize.apply(moves, self.root / 'dsh')
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())

    def test_destination_parent_links_are_rejected(self):
        (self.root / 'dsh-one-api-build.Abcd').mkdir()
        (self.root / 'elsewhere').mkdir()
        try:
            (self.root / 'dsh').symlink_to(self.root / 'elsewhere', target_is_directory=True)
        except OSError:
            self.skipTest('Creating symlinks requires Windows developer mode or privilege')
        with self.assertRaisesRegex(RuntimeError, 'Unsafe directory'):
            organize.plan(self.root, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
