"""Offline regression checks: no Docker daemon or production service is touched."""
import ast
import contextlib
import copy
import io
import json
import pathlib
import re
import sys
import tempfile
import tarfile
import unittest
import hashlib
import os
import shutil
import subprocess

SCRIPT = pathlib.Path(__file__).with_name('deploy-oneapi.sh').read_text(encoding='utf-8')
BLOCKS = re.findall(r"<<'PY'\n(.*?)\nPY", SCRIPT, re.S)
PUBLIC_KEY = re.search(r"^UPDATE_PUBLIC_KEY='([^']+)'", SCRIPT, re.M).group(1)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.temp.name) / 'inspect.json'
        self.old_id = 'a' * 64
        self.container = {
            'State': {'Running': True},
            'Config': {'Hostname': self.old_id[:12], 'Image': 'old:image',
                       'Env': ['SQL_DSN=test-only', 'OTHER=retained', 'SERVER_ADDRESS=https://existing.example', 'DESKTOP_UPDATE_PUBLIC_KEY=' + PUBLIC_KEY],
                       'Cmd': ['--port', '3000'], 'Entrypoint': ['/one-api'],
                       'Labels': {'example': 'retained'}},
            'HostConfig': {'NetworkMode': 'dsh-internal',
                           'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '13300'}]},
                           'RestartPolicy': {'Name': 'unless-stopped'},
                           'Binds': ['/example:/data'], 'Memory': 123456,
                           'LogConfig': {'Type': 'json-file', 'Config': {'max-size': '10m'}}},
            'Mounts': [{'Type': 'bind', 'Destination': '/data', 'RW': True}],
            'NetworkSettings': {'Networks': {'dsh-internal': {'Aliases': ['dsh-one-api', 'custom-alias', self.old_id[:12]]}}},
        }

    def tearDown(self):
        self.temp.cleanup()

    def run_block(self, code, args, namespace=None):
        self.path.write_text(json.dumps([self.container]))
        prior = sys.argv
        if code == BLOCKS[0] and not args:
            args = ['strict']
        if code == BLOCKS[0]:
            args = [*args, PUBLIC_KEY]
        sys.argv = ['fixture', str(self.path), *args]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                exec(code, namespace if namespace is not None else {})
        finally:
            sys.argv = prior

    def test_expected_topology_passes(self):
        self.run_block(BLOCKS[0], [])

    def test_layout_preparation_executes_under_one_storage_root(self):
        function = re.search(r'prepare_layout\(\) \{\n.*?\n\}', SCRIPT, re.S).group(0)
        root = (pathlib.Path(self.temp.name) / 'dsh').as_posix()
        if os.name == 'nt':
            root = '/' + root[0].lower() + root[2:]
            bash = pathlib.Path(shutil.which('git')).parent.parent / 'bin/bash.exe'
        else:
            bash = pathlib.Path(shutil.which('bash'))
        code = 'set -eu\numask 077\ndie() { echo "$*" >&2; exit 1; }\n' + function.replace('/root/dsh', root) + '\nprepare_layout\n'
        kwargs = {'capture_output': True, 'text': True}
        if os.name == 'nt':
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        result = subprocess.run([str(bash), '-c', code], **kwargs)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for name in ('builds', 'updates', 'backups/database', 'backups/migrations', 'data', 'releases'):
            self.assertTrue((pathlib.Path(self.temp.name) / 'dsh' / name).is_dir())

    def test_compose_upload_paths_persist_both_artifact_kinds_under_dsh(self):
        compose = pathlib.Path(__file__).resolve().parents[2] / 'services/docker-compose.yml'
        content = compose.read_text(encoding='utf-8')
        for kind, variable in (('updates', 'UPDATE'), ('resources', 'RESOURCE')):
            container = '/data/desktop-' + kind
            self.assertIn('DESKTOP_' + variable + '_DIR: ' + container, content)
            self.assertIn('${DSH_DESKTOP_' + variable + '_HOST_DIR:-/root/dsh/data/desktop-' + kind + '}:' + container, content)

    def test_missing_or_readonly_resource_storage_rejected(self):
        for mounts in ([], [{'Type': 'bind', 'Destination': '/data', 'RW': False}],
                       [{'Type': 'bind', 'Destination': '/data-other', 'RW': True}]):
            self.container['Mounts'] = mounts
            with self.assertRaises(AssertionError):
                self.run_block(BLOCKS[0], [])

    def test_custom_persistent_resource_storage_passes(self):
        self.container['Config']['Env'].append('DESKTOP_RESOURCE_DIR=/resources/wheels')
        self.container['Mounts'].append({'Type': 'volume', 'Name': 'resources',
                                        'Destination': '/resources', 'RW': True})
        self.run_block(BLOCKS[0], [])

    def test_legacy_no_mounts_allows_explicit_initialization_only(self):
        self.container['Mounts'] = []
        self.container['HostConfig']['Binds'] = []
        self.run_block(BLOCKS[0], ['allow-init'])
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], ['strict'])
        self.container['Config']['Env'].append('DESKTOP_RESOURCE_DIR=/custom')
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], ['allow-init'])

    def test_readonly_or_unrelated_mount_not_automatically_replaced(self):
        for mount in ({'Type': 'bind', 'Destination': '/data', 'RW': False},
                      {'Type': 'bind', 'Destination': '/other', 'RW': True}):
            self.container['Mounts'] = [mount]
            with self.assertRaises(AssertionError):
                self.run_block(BLOCKS[0], ['allow-init'])

    def test_public_port_or_extra_port_rejected(self):
        for change in ('public', 'extra'):
            with self.subTest(change=change):
                original = copy.deepcopy(self.container)
                if change == 'public':
                    self.container['HostConfig']['PortBindings']['3000/tcp'][0] = {'HostIp': '0.0.0.0', 'HostPort': '3300'}
                else:
                    self.container['HostConfig']['PortBindings']['3001/tcp'] = [{'HostIp': '', 'HostPort': '3301'}]
                with self.assertRaises(AssertionError):
                    self.run_block(BLOCKS[0], [])
                self.container = original

    def test_missing_database_or_static_address_rejected(self):
        self.container['Config']['Env'] = ['OTHER=retained']
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], [])
        self.container['Config']['Env'] = ['SQL_DSN=test-only']
        self.container['NetworkSettings']['Networks']['dsh-internal']['IPAMConfig'] = {'IPv4Address': '172.20.0.9'}
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], [])

    def clone_payload(self, resource_bind='', update_bind=''):
        # Stub Docker transport while executing the actual release payload builder.
        tree = ast.parse(BLOCKS[1])
        tree.body = [node for node in tree.body if not isinstance(node, (ast.ClassDef, ast.FunctionDef))]
        calls = []
        def request(method, path, body=None):
            calls.append((method, path, body))
            return {'ApiVersion': '1.45'} if method == 'GET' else {'Id': 'new-container-id'}
        self.run_block(compile(tree, 'release-clone', 'exec'), ['sha256:new-image', self.old_id, resource_bind, update_bind, PUBLIC_KEY], {'request': request})
        return calls[1][2]

    def test_no_download_address_configuration_required_or_injected(self):
        self.container['Config']['Env'] = [e for e in self.container['Config']['Env'] if not e.startswith('SERVER_ADDRESS=')]
        self.run_block(BLOCKS[0], ['strict'])
        payload = self.clone_payload()
        self.assertFalse(any(e.startswith('DESKTOP_UPDATE_PUBLIC_URL=') for e in payload['Env']))
        self.assertNotIn('ac.zjugis.com:3300', SCRIPT)
        self.container['Config']['Env'].append('DESKTOP_UPDATE_PUBLIC_URL=https://custom.example')
        self.assertIn('DESKTOP_UPDATE_PUBLIC_URL=https://custom.example', self.clone_payload()['Env'])
        self.run_block(BLOCKS[0], ['strict'])

    def test_missing_public_key_initialized_without_losing_other_environment(self):
        self.container['Config']['Env'].pop()
        self.run_block(BLOCKS[0], ['allow-init'])
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], ['strict'])
        payload = self.clone_payload()
        self.assertEqual(payload['Env'], self.container['Config']['Env'] + ['DESKTOP_UPDATE_PUBLIC_KEY=' + PUBLIC_KEY])

    def test_existing_different_key_requires_manual_rotation(self):
        self.container['Config']['Env'][-1] = 'DESKTOP_UPDATE_PUBLIC_KEY=different'
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], ['allow-init'])
        with self.assertRaises(AssertionError):
            self.clone_payload()

    def test_update_storage_initialization_preserves_resource_mounts(self):
        self.container['Mounts'] = [{'Type': 'bind', 'Destination': '/data/desktop-resources', 'RW': True}]
        self.container['HostConfig']['Binds'] = ['/resources:/data/desktop-resources']
        self.run_block(BLOCKS[0], ['allow-init'])
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], ['strict'])
        payload = self.clone_payload(update_bind='/root/dsh/data/one-api-updates.example')
        self.assertEqual(payload['HostConfig']['Binds'], self.container['HostConfig']['Binds'])
        self.assertEqual(payload['HostConfig']['Mounts'], [{'Type': 'bind', 'Source': '/root/dsh/data/one-api-updates.example', 'Target': '/data/wanwei/desktop-updates', 'ReadOnly': False}])
        self.container['Mounts'].append({'Type': 'bind', 'Destination': '/data/wanwei/desktop-updates', 'RW': True})
        self.run_block(BLOCKS[0], ['strict'])

    def test_readonly_update_child_overrides_writable_parent(self):
        self.container['Mounts'].append({'Type': 'bind', 'Destination': '/data/wanwei/desktop-updates', 'RW': False})
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], ['allow-init'])

    def test_custom_update_path_requires_existing_persistence(self):
        self.container['Config']['Env'].append('DESKTOP_UPDATE_DIR=/custom-updates')
        with self.assertRaises(AssertionError):
            self.run_block(BLOCKS[0], ['allow-init'])
        self.container['Mounts'].append({'Type': 'volume', 'Name': 'updates', 'Destination': '/custom-updates', 'RW': True})
        self.run_block(BLOCKS[0], ['strict'])

    def test_update_bind_rejects_unexpected_and_overlapping_paths(self):
        for bind in ('/unrelated', '/root/dsh/data/one-api-updates.example'):
            with self.assertRaises(AssertionError):
                self.clone_payload(update_bind=bind)

    def test_no_mount_legacy_adds_both_stores(self):
        self.container['Mounts'] = []
        self.container['HostConfig']['Binds'] = []
        payload = self.clone_payload('/root/dsh/data/one-api-resources.example', '/root/dsh/data/one-api-updates.example')
        self.assertEqual(len(payload['HostConfig']['Mounts']), 2)

    def test_clone_preserves_configuration(self):
        payload = self.clone_payload()
        self.assertEqual(payload['HostConfig'], self.container['HostConfig'])
        for key in ('Env', 'Cmd', 'Entrypoint', 'Labels'):
            self.assertEqual(payload[key], self.container['Config'][key])
        self.assertEqual(payload['Image'], 'sha256:new-image')
        self.assertEqual(payload['NetworkingConfig']['EndpointsConfig']['dsh-internal']['Aliases'], ['dsh-one-api', 'custom-alias'])

    def test_legacy_clone_only_adds_resource_subdirectory(self):
        self.container['Mounts'] = []
        self.container['HostConfig']['Binds'] = []
        original = copy.deepcopy(self.container)
        bind = '/root/dsh/data/one-api-resources.example'
        payload = self.clone_payload(bind)
        added = payload['HostConfig'].pop('Mounts')
        self.assertEqual(added, [{'Type': 'bind', 'Source': bind,
                                 'Target': '/data/desktop-resources', 'ReadOnly': False}])
        self.assertEqual(payload['HostConfig'], original['HostConfig'])
        self.assertEqual(payload['Env'], original['Config']['Env'])

    def test_resource_bind_rejects_existing_mounts_and_unexpected_paths(self):
        with self.assertRaises(AssertionError):
            self.clone_payload('/root/dsh/data/one-api-resources.example')
        self.container['Mounts'] = []
        self.container['HostConfig']['Binds'] = []
        with self.assertRaises(AssertionError):
            self.clone_payload('/unrelated')

    def test_storage_preparation_happens_before_stopping_container(self):
        deploy = SCRIPT.split('deploy() {', 1)[1]
        self.assertLess(deploy.index('docker exec'), deploy.index('docker stop'))
        self.assertLess(deploy.index('RESOURCE_BIND=$(mktemp'), deploy.index('docker stop'))
        self.assertIn('test ! -e /data/desktop-resources', deploy)
        self.assertIn('test ! -L /data/desktop-resources', deploy)
        self.assertLess(deploy.index('UPDATE_BIND=$(mktemp'), deploy.index('docker stop'))
        self.assertIn('test ! -e /data/wanwei/desktop-updates', deploy)
        self.assertIn('test ! -L /data/wanwei/desktop-updates', deploy)

    def test_no_gateway_mutation(self):
        self.assertNotRegex(SCRIPT, r'docker (?:stop|rm|rename|restart|run).*\$GATEWAY')
        self.assertNotIn('-p 3300:3000', SCRIPT)

    def test_failure_keeps_diagnostics_and_container(self):
        rollback = SCRIPT.split('rollback_on_exit() {', 1)[1].split('validate_db_backup() {', 1)[0]
        self.assertNotIn('docker rm', rollback)
        self.assertLess(rollback.index('docker logs'), rollback.index('docker stop'))
        self.assertLess(rollback.index('docker inspect --format'), rollback.index('docker stop'))
        self.assertIn('docker rename "$current" "$failed_name"', rollback)
        self.assertIn('docker start "$CONTAINER"', rollback)

    def test_startup_reports_progress_and_detects_exit(self):
        self.assertIn('attempt % 5 == 0', SCRIPT)
        self.assertIn('container=$container_state', SCRIPT)
        self.assertIn('exited|dead)', SCRIPT)

    def test_release_checks_are_owned_by_committed_dockerfile(self):
        dockerfile = pathlib.Path(__file__).parents[2] / 'services/one-api/Dockerfile'
        if dockerfile.exists():
            content = dockerfile.read_text(encoding='utf-8')
            self.assertIn('UserIdentityUpdate|Desktop)', content)
            self.assertIn('src/pages/Zjugis/ResourceSettings.test.js', content)
            self.assertIn('go test ./model', content)

    def test_archive_validation_rejects_traversal_links_and_missing_files(self):
        code = re.search(r"<<'SAFE'\n(.*?)\nSAFE", SCRIPT, re.S).group(1)
        archive = pathlib.Path(self.temp.name) / 'source.tar.gz'
        for name, member_type in (('../escape', tarfile.REGTYPE),
                                  ('services/one-api/link', tarfile.SYMTYPE),
                                  ('services/one-api/only-one-file', tarfile.REGTYPE)):
            with tarfile.open(archive, 'w:gz') as t:
                member = tarfile.TarInfo(name)
                member.type = member_type
                t.addfile(member)
            prior = sys.argv
            sys.argv = ['archive-test', str(archive)]
            try:
                with self.assertRaises(AssertionError):
                    exec(code, {})
            finally:
                sys.argv = prior

    def test_manifest_parser_checks_version_hashes_and_kind_without_eval(self):
        code = re.search(r"<<'META'\n(.*?)\nMETA", SCRIPT, re.S).group(1)
        archive = pathlib.Path(self.temp.name) / 'dsh-server-source-1.2.3.tar.gz'
        archive.write_bytes(b'test-fixture-only')
        deployer = pathlib.Path(self.temp.name) / 'deploy-oneapi.sh'
        deployer.write_bytes(SCRIPT.encode())
        import hashlib
        m = {
            'schemaVersion': 1, 'kind': 'oneapi-source', 'version': '1.2.3',
            'commit': 'a' * 40,
            'archive': {'file': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                        'bytes': archive.stat().st_size},
            'deployer': {'sha256': hashlib.sha256(deployer.read_bytes()).hexdigest()}
        }
        manifest = pathlib.Path(self.temp.name) / 'release.json'
        prior = sys.argv
        sys.argv = ['manifest-test', str(manifest), str(deployer)]
        try:
            manifest.write_text(json.dumps(m))
            with contextlib.redirect_stdout(io.StringIO()):
                exec(code, {})
            for key, bad in (('version', '../bad'), ('kind', 'docker-image'), ('commit', 'not-a-sha')):
                wrong = copy.deepcopy(m)
                wrong[key] = bad
                manifest.write_text(json.dumps(wrong))
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    exec(code, {})
            manifest.write_text(json.dumps(m))
            archive.write_bytes(b'corrupted')
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                exec(code, {})
        finally:
            sys.argv = prior

    def test_version_health_and_image_provenance_are_checked(self):
        self.assertIn('org.opencontainers.image.revision', SCRIPT)
        self.assertIn('io.wanwei.oneapi.source-sha256', SCRIPT)
        self.assertIn('d.get("success") is True', SCRIPT)
        self.assertIn('get("version")==sys.argv[1]', SCRIPT)
        self.assertNotIn("source release.json", SCRIPT)
        self.assertNotRegex(SCRIPT, r'(?m)^\s*(eval|source)\s')
        self.assertIn('update) validate_db_backup', SCRIPT)

    def test_bash_verify_accepts_valid_release_and_rejects_tamper_without_docker(self):
        if os.name == 'nt':
            bash = pathlib.Path(shutil.which('git')).parent.parent / 'bin/bash.exe'
        else:
            bash = pathlib.Path(shutil.which('bash'))
        self.assertTrue(bash.exists(), 'Bash is required for deployment entry-point testing')
        root = pathlib.Path(self.temp.name)
        deployer = root / 'deploy-oneapi.sh'
        deployer.write_bytes(SCRIPT.encode())
        archive = root / 'dsh-server-source-1.2.3.tar.gz'
        with tarfile.open(archive, 'w:gz') as t:
            for name in ('Dockerfile', 'go.mod', 'go.sum', 'web/air/package-lock.json', 'web/org-admin/package-lock.json'):
                member = tarfile.TarInfo('services/one-api/' + name)
                t.addfile(member)
        manifest = {
            'schemaVersion': 1, 'kind': 'oneapi-source', 'version': '1.2.3', 'commit': 'a' * 40,
            'archive': {'file': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'bytes': archive.stat().st_size},
            'deployer': {'sha256': hashlib.sha256(deployer.read_bytes()).hexdigest()}
        }
        (root / 'release.json').write_text(json.dumps(manifest))
        shim = root / 'bin'
        shim.mkdir()
        # Isolate the entry-point test from Docker and Windows Python app aliases.
        (shim / 'python3').write_text('#!/usr/bin/env bash\nexec "' + pathlib.Path(sys.executable).as_posix() + '" "$@"\n', newline='\n')
        (shim / 'docker').write_text('#!/usr/bin/env bash\necho DOCKER_MUST_NOT_RUN >&2\nexit 98\n', newline='\n')
        (shim / 'python3').chmod(0o700)
        (shim / 'docker').chmod(0o700)
        shim_path = shim.as_posix()
        if os.name == 'nt':
            shim_path = '/' + shim_path[0].lower() + shim_path[2:]
        command = 'export PATH="' + shim_path + ':$PATH"; exec bash "' + deployer.as_posix() + '" verify --package "' + archive.as_posix() + '"'
        kwargs = {'capture_output': True, 'text': True}
        if os.name == 'nt':
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        valid = subprocess.run([str(bash), '-c', command], **kwargs)
        self.assertEqual(valid.returncode, 0, valid.stdout + valid.stderr)
        self.assertIn('Verified: 1.2.3', valid.stdout)
        archive.write_bytes(b'tampered')
        invalid = subprocess.run([str(bash), '-c', command], **kwargs)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertNotIn('DOCKER_MUST_NOT_RUN', invalid.stderr)

if __name__ == '__main__':
    unittest.main(verbosity=2)
