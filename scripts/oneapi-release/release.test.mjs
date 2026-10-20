import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { included, inspectRelease, packageRelease, parseArgs } from './release.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function git(repo, ...args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oneapi-release-test-'))
  t.after(() => {
    assert.equal(dirname(root), tmpdir())
    assert.ok(root.split(/[\\/]/).at(-1).startsWith('oneapi-release-test-'))
    rmSync(root, { recursive: true })
  })
  const repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  git(repo, 'config', 'core.autocrlf', 'false')
  function put(path, content) {
    const target = join(repo, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const manifest = { name: 'fixture', dependencies: { react: '18.2.0' } }
  for (const folder of ['air', 'org-admin']) {
    put(`services/one-api/web/${folder}/package.json`, JSON.stringify(manifest))
    put(`services/one-api/web/${folder}/package-lock.json`, JSON.stringify({ lockfileVersion: 3, packages: { '': manifest } }))
  }
  for (const name of ['Dockerfile', '.dockerignore', 'go.mod', 'go.sum', 'main.go']) put(`services/one-api/${name}`, 'fixture\n')
  for (const name of ['controller/desktop_resources.go', 'controller/desktop_update.go', 'web/air/src/pages/Zjugis/ResourceSettings.js']) put(`services/one-api/${name}`, 'fixture\n')
  put('services/one-api/.env', 'TEST_ONLY=must-not-ship\n')
  put('services/one-api/.env.example', 'EXAMPLE=\n')
  put('services/one-api/web/air/node_modules/mock.js', 'must-not-ship\n')
  put('scripts/oneapi-release/deploy-oneapi.sh', readFileSync(join(here, 'deploy-oneapi.sh')))
  put('docs/developer/oneapi-release.zh.md', 'Test fixture guide\n')
  function commit() {
    git(repo, 'add', '-A')
    git(repo, '-c', 'core.hooksPath=', '-c', 'user.name=ReleaseTest', '-c', 'user.email=release-test@example.invalid', 'commit', '-qm', 'fixture')
    return git(repo, 'rev-parse', 'HEAD')
  }
  const commitId = commit()
  const options = { repo, output: join(root, 'delivery'), version: '1.2.3-test.1', ref: 'HEAD' }
  return { root, repo, put, commit, commitId, options }
}

test('CLI validates versions, duplicate and unknown arguments', () => {
  assert.equal(parseArgs(['--version', '0.0.77-resources.1']).version, '0.0.77-resources.1')
  assert.equal(parseArgs(['--status']).status, true)
  for (const args of [[], ['--version', '../escape'], ['--version', '1.0.0;echo'], ['--version'], ['--unknown'], ['--version', '1.0.0', '--version', '2.0.0'], ['--version', '1.0.0', '--ref', '-bad']]) {
    assert.throws(() => parseArgs(args))
  }
})

test('source selection excludes runtime data and credentials, keeps examples', () => {
  for (const path of ['.env', '.env.production', 'server.key', 'db.sqlite', 'credentials.json', 'web/air/node_modules/a.js', 'data/a.txt', '.claude/settings.json', 'web/air/build/a.js']) {
    assert.equal(included(`services/one-api/${path}`), false, path)
  }
  assert.equal(included('services/one-api/.env.example'), true)
  assert.equal(included('services/one-api/controller/example.go'), true)
  assert.equal(included('apps/desktop/a.js'), false)
})

test('preflight inspects a committed source without creating output', t => {
  const f = fixture(t)
  const result = packageRelease({ ...f.options, check: true })
  assert.equal(result.commit, f.commitId)
  assert.equal(existsSync(f.options.output), false)
})

test('packages actual Git archive, manifest, checksums and fixed commands without index changes', t => {
  const f = fixture(t)
  const indexBefore = readFileSync(join(f.repo, '.git/index'))
  const result = packageRelease(f.options)
  const manifest = JSON.parse(readFileSync(join(result.destination, 'release.json')))
  assert.equal(manifest.commit, f.commitId)
  assert.equal(manifest.kind, 'oneapi-source')
  assert.ok(manifest.archive.bytes > 0)
  assert.equal(existsSync(join(result.destination, 'INCOMPLETE.txt')), false)
  assert.ok(existsSync(join(result.destination, 'PACKAGING-COMPLETE.txt')))
  assert.match(readFileSync(join(result.destination, 'COMMANDS.txt'), 'utf8'), /update --package .* --db-backup/)
  assert.deepEqual(readFileSync(join(f.repo, '.git/index')), indexBefore)
  assert.equal(git(f.repo, 'status', '--porcelain'), '')
  const tar = spawnSync('tar', ['-tzf', join(result.destination, manifest.archive.file)], { encoding: 'utf8', windowsHide: true })
  assert.equal(tar.status, 0, tar.stderr)
  assert.match(tar.stdout, /services\/one-api\/main.go/)
  assert.match(tar.stdout, /\.env.example/)
  assert.doesNotMatch(tar.stdout, /node_modules|one-api\/\.env\r?\n/)
  assert.throws(() => packageRelease(f.options), /already exists/)
})

test('rejects modified, staged and untracked backend work before creating files', t => {
  const f = fixture(t)
  f.put('services/one-api/main.go', 'changed\n')
  assert.throws(() => packageRelease(f.options), /Uncommitted backend/)
  git(f.repo, 'add', 'services/one-api/main.go')
  assert.throws(() => packageRelease(f.options), /Uncommitted backend/)
  f.commit()
  f.put('services/one-api/new.go', 'untracked\n')
  assert.throws(() => packageRelease(f.options), /Uncommitted backend/)
  assert.equal(existsSync(f.options.output), false)
})

test('unrelated uncommitted desktop files do not enter the package', t => {
  const f = fixture(t)
  f.put('apps/desktop/unrelated.js', 'uncommitted\n')
  const result = inspectRelease(f.options)
  assert.equal(result.commit, f.commitId)
  assert.ok(result.files.every(file => file.path.startsWith('services/one-api/')))
})

test('ref selection packages the exact older commit, never HEAD contents', t => {
  const f = fixture(t)
  f.put('services/one-api/main.go', 'newer commit\n')
  f.commit()
  const result = packageRelease({ ...f.options, ref: f.commitId })
  const manifest = JSON.parse(readFileSync(join(result.destination, 'release.json')))
  assert.equal(manifest.commit, f.commitId)
  const tar = spawnSync('tar', ['-xOzf', join(result.destination, manifest.archive.file), 'services/one-api/main.go'], { encoding: 'utf8', windowsHide: true })
  assert.equal(tar.status, 0, tar.stderr)
  assert.equal(tar.stdout, 'fixture\n')
})

test('missing committed lockfiles and mismatched lock dependencies fail preflight', t => {
  const f = fixture(t)
  git(f.repo, 'rm', 'services/one-api/web/air/package-lock.json')
  f.commit()
  assert.throws(() => inspectRelease(f.options), /Missing committed file/)
  f.put('services/one-api/web/air/package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { react: 'different' } } } }))
  f.commit()
  assert.throws(() => inspectRelease(f.options), /out of sync/)
})

test('status reports dirty files without trying to package', t => {
  const f = fixture(t)
  f.put('services/one-api/new.go', 'untracked\n')
  const result = packageRelease({ ...f.options, status: true })
  assert.match(result.dirty, /new.go/)
  assert.equal(existsSync(f.options.output), false)
})

test('rejects output inside source repo and never overwrites existing directories', t => {
  const f = fixture(t)
  assert.throws(() => inspectRelease({ ...f.options, output: f.repo }), /outside the source/)
  mkdirSync(join(f.options.output, f.options.version), { recursive: true })
  writeFileSync(join(f.options.output, f.options.version, 'keep.txt'), 'keep')
  assert.throws(() => packageRelease(f.options), /already exists/)
  assert.deepEqual(readdirSync(join(f.options.output, f.options.version)), ['keep.txt'])
})

test('CLI help exits successfully without Docker or repository mutation', () => {
  const result = spawnSync(process.execPath, [resolve(here, 'release.mjs'), '--help'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Does not commit, push, upload/)
})

test('server topology, preservation, rollback and archive regression checks', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const result = spawnSync(python, [join(here, 'test_deploy.py')], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
})
