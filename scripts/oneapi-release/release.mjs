/** Package committed OneAPI sources without changing the user's Git index or worktree. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourceRoot = 'services/one-api'
const toolRoot = 'scripts/oneapi-release'
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/
const required = [
  'Dockerfile', '.dockerignore', 'go.mod', 'go.sum', 'main.go',
  'web/air/package.json', 'web/air/package-lock.json',
  'web/org-admin/package.json', 'web/org-admin/package-lock.json',
  'controller/desktop_resources.go', 'controller/desktop_update.go',
  'web/air/src/pages/Zjugis/ResourceSettings.js',
]

function runGit(repo, args, options = {}) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr).trim()}`)
  return result.stdout
}

/** Return whether a tracked source path is safe to include in a distributable archive. */
export function included(path) {
  const parts = path.split('/')
  const base = parts.at(-1)
  if (parts.some(p => ['.git', '.claude', 'node_modules', '__pycache__', '.cache', 'coverage', 'data', 'logs', 'uploads', '.batch-build-check'].includes(p))) return false
  if (/^\.env(?:\.|$)/.test(base) && base !== '.env.example') return false
  if (/\.(?:db|sqlite|sqlite3|log|pyc|pem|key|p12|pfx)$/i.test(base)) return false
  if (/^(?:credentials|secrets?)\.(?:json|ya?ml)$/i.test(base)) return false
  if (/^services\/one-api\/web\/(?:build|air\/build|org-admin\/build)(?:\/|$)/.test(path)) return false
  return path.startsWith(sourceRoot + '/')
}

/** Validate user arguments before Git or filesystem mutations. */
export function parseArgs(args) {
  const result = { ref: 'HEAD', check: false, status: false, help: false }
  const used = new Set()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') continue
    if (used.has(arg)) throw new Error(`Duplicate argument: ${arg}`)
    used.add(arg)
    if (['--check', '--status', '--help', '-h'].includes(arg)) {
      result[({ '--check': 'check', '--status': 'status', '--help': 'help', '-h': 'help' })[arg]] = true
    } else if (['--version', '--ref', '--repo', '--output'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`)
      result[arg.slice(2)] = value
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!result.help && !result.status && (!versionPattern.test(result.version ?? '') || result.version.length > 80)) {
    throw new Error('Use --version X.Y.Z or X.Y.Z-label.N (lowercase, at most 80 characters).')
  }
  if (result.ref.startsWith('-')) throw new Error('Git ref must not start with a dash.')
  return result
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function backendStatus(repo) {
  return runGit(repo, ['status', '--porcelain=v1', '--untracked-files=all', '--', sourceRoot]).trim()
}

function validateLock(repo, commit, folder) {
  const prefix = `${sourceRoot}/web/${folder}`
  const manifest = JSON.parse(runGit(repo, ['show', `${commit}:${prefix}/package.json`]))
  const lock = JSON.parse(runGit(repo, ['show', `${commit}:${prefix}/package-lock.json`]))
  const root = lock.packages?.['']
  if (!root || lock.lockfileVersion < 2) throw new Error(`${folder}: npm lockfile v2/v3 required.`)
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const canonical = obj => JSON.stringify(Object.entries(obj ?? {}).sort(([a], [b]) => a.localeCompare(b)))
    if (canonical(manifest[section]) !== canonical(root[section])) {
      throw new Error(`${prefix}/package-lock.json is out of sync with package.json. Run npm install --package-lock-only, review and commit the lock.`)
    }
  }
}

/** Check source selection without creating a release directory or changing the repository. */
export function inspectRelease(options) {
  const defaultRepo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const repo = runGit(resolve(options.repo ?? defaultRepo), ['rev-parse', '--show-toplevel']).trim()
  const commit = runGit(repo, ['rev-parse', '--verify', `${options.ref}^{commit}`]).trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected a full SHA-1 Git commit.')
  const dirty = backendStatus(repo)
  const branch = runGit(repo, ['branch', '--show-current']).trim() || '(detached)'
  const upstream = spawnSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', '@{upstream}'], { encoding: 'utf8', windowsHide: true })
  const counts = upstream.status === 0 ? runGit(repo, ['rev-list', '--left-right', '--count', `HEAD...${upstream.stdout.trim()}`]).trim() : 'no upstream'
  if (options.status) return { repo, commit, branch, upstream: upstream.stdout?.trim(), counts, dirty }
  if (dirty) throw new Error(`Uncommitted backend files will NOT be packaged. Review and commit them first:\n${dirty}\nUse --status to inspect; no release files were created.`)
  const entries = runGit(repo, ['ls-tree', '-r', '-z', commit, '--', sourceRoot]).split('\0').filter(Boolean).map(row => {
    const [meta, path] = row.split('\t')
    return { mode: meta.split(' ')[0], path }
  })
  const files = entries.filter(e => included(e.path))
  for (const file of files) {
    if (!['100644', '100755'].includes(file.mode)) throw new Error(`Links/submodules are not supported: ${file.path}`)
    if (/[\r\n\\]/.test(file.path)) throw new Error(`Unsafe source path: ${file.path}`)
  }
  const names = new Set(files.map(e => e.path))
  for (const path of required) {
    if (!names.has(`${sourceRoot}/${path}`)) throw new Error(`Missing committed file: ${sourceRoot}/${path}. Review and git add -f the lockfile if ignored, then commit it.`)
  }
  for (const folder of ['air', 'org-admin']) validateLock(repo, commit, folder)
  const deployer = runGit(repo, ['show', `${commit}:${toolRoot}/deploy-oneapi.sh`])
  const organizer = runGit(repo, ['show', `${commit}:${toolRoot}/organize-oneapi.py`])
  if (deployer.includes('\r') || !deployer.startsWith('#!/usr/bin/env bash\n')) throw new Error('Committed deployment script must be UTF-8 with LF line endings.')
  const guide = runGit(repo, ['show', `${commit}:docs/developer/oneapi-release.zh.md`])
  const outputBase = resolve(options.output ?? join(repo, '..', 'delivery', 'oneapi'))
  const destination = join(outputBase, options.version)
  const withinRepo = relative(repo, destination)
  if (!withinRepo.startsWith('..') && !isAbsolute(withinRepo)) throw new Error('Release output must be outside the source repository.')
  if (existsSync(destination)) throw new Error(`Release already exists; use a new version: ${destination}`)
  return { repo, commit, branch, counts, files, excluded: entries.filter(e => !included(e.path)), deployer, organizer, guide, outputBase, destination }
}

/** Create one immutable version directory; partial failures remain clearly marked, never overwritten. */
export function packageRelease(options) {
  const inspected = inspectRelease(options)
  if (options.status || options.check) return inspected
  const { repo, commit, files, outputBase, destination, deployer, organizer, guide } = inspected
  mkdirSync(outputBase, { recursive: true })
  mkdirSync(destination)
  const incomplete = join(destination, 'INCOMPLETE.txt')
  writeFileSync(incomplete, 'INCOMPLETE release; do not deploy. See error output. Use a new version or review this directory manually.\n', { flag: 'wx' })
  const archiveName = `dsh-server-source-${options.version}.tar.gz`
  const archive = join(destination, archiveName)
  // A private index avoids Windows command-line limits and never touches the user's staging area.
  const temporary = mkdtempSync(join(tmpdir(), 'oneapi-release-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }
    runGit(repo, ['read-tree', commit], { env })
    if (inspected.excluded.length) {
      runGit(repo, ['update-index', '--force-remove', '-z', '--stdin'], {
        env, input: inspected.excluded.map(e => e.path).join('\0') + '\0',
      })
    }
    const tree = runGit(repo, ['write-tree'], { env }).trim()
    runGit(repo, ['archive', '--format=tar.gz', `--output=${archive}`, tree, '--', sourceRoot])
  } finally {
    // mkdtemp exclusively creates this exact child; never delete a caller-provided directory.
    if (dirname(temporary) !== tmpdir() || !temporary.split(/[\\/]/).at(-1).startsWith('oneapi-release-')) throw new Error('Unexpected temporary directory; refusing cleanup.')
    rmSync(temporary, { recursive: true })
  }
  const archiveHash = sha256(readFileSync(archive))
  const deploymentHash = sha256(Buffer.from(deployer, 'utf8'))
  const organizerHash = sha256(Buffer.from(organizer, 'utf8'))
  writeFileSync(join(destination, 'deploy-oneapi.sh'), deployer, { flag: 'wx' })
  writeFileSync(join(destination, 'organize-oneapi.py'), organizer, { flag: 'wx' })
  const manifest = {
    schemaVersion: 1, kind: 'oneapi-source', version: options.version,
    commit, sourceTree: runGit(repo, ['rev-parse', `${commit}:${sourceRoot}`]).trim(),
    createdAt: new Date().toISOString(), sourceFiles: files.length,
    archive: { file: archiveName, sha256: archiveHash, bytes: statSync(archive).size },
    deployer: { file: 'deploy-oneapi.sh', sha256: deploymentHash },
    organizer: { file: 'organize-oneapi.py', sha256: organizerHash },
    verification: 'Packaging checks only. Docker build runs committed frontend/backend checks on the server. No production deployment performed.',
  }
  writeFileSync(join(destination, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  const manifestHash = sha256(readFileSync(join(destination, 'release.json')))
  writeFileSync(join(destination, 'SHA256SUMS'), `${archiveHash}  ${archiveName}\n${deploymentHash}  deploy-oneapi.sh\n${organizerHash}  organize-oneapi.py\n${manifestHash}  release.json\n`, { flag: 'wx' })
  writeFileSync(join(destination, 'README.zh.md'), guide, { flag: 'wx' })
  const commands = [
    '# Upload this complete directory into /root/dsh/releases/' + options.version,
    'cd /root/dsh/releases/' + options.version,
    'sha256sum -c SHA256SUMS',
    `bash deploy-oneapi.sh verify --package ./${archiveName}`,
    `bash deploy-oneapi.sh check --package ./${archiveName}`,
    '# Optional legacy directory organization: check first, then apply the reviewed plan:',
    '# python3 organize-oneapi.py check',
    '# python3 organize-oneapi.py apply',
    '# Replace the backup path with an existing nonempty database backup file:',
    `bash deploy-oneapi.sh update --package ./${archiveName} --db-backup /root/dsh/backups/database/backup.sql`,
    '# Alternative ONLY if deliberately accepting database migration risk:',
    `# bash deploy-oneapi.sh update --package ./${archiveName} --skip-db-backup`,
    '',
  ].join('\n')
  writeFileSync(join(destination, 'COMMANDS.txt'), commands, { flag: 'wx' })
  writeFileSync(join(destination, 'RELEASE.txt'), `OneAPI ${options.version}\nCommit: ${commit}\nType: source archive, NOT a Docker image.\nSource files: ${files.length}\n\n${commands}`, { flag: 'wx' })
  renameSync(incomplete, join(destination, 'PACKAGING-COMPLETE.txt'))
  writeFileSync(join(destination, 'PACKAGING-COMPLETE.txt'), 'Packaging checks passed; server build, database backup and application acceptance remain required.\n')
  return inspected
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node scripts/oneapi-release/release.mjs --version 0.0.77-resources.1 [--ref HEAD] [--check] [--repo PATH] [--output PATH]\n       node scripts/oneapi-release/release.mjs --status\nPackages committed backend files only. Does not commit, push, upload, build Docker or deploy.')
    return
  }
  const result = packageRelease(options)
  if (options.status) {
    console.log(`Repository: ${result.repo}\nBranch: ${result.branch}\nCommit: ${result.commit}\nCached upstream: ${result.upstream || '(none)'} (ahead/behind: ${result.counts}; no fetch performed)\nBackend changes:\n${result.dirty || '(clean)'}`)
  } else console.log(`${options.check ? 'Preflight passed' : 'Release packaged'}: ${options.version}\nCommit: ${result.commit}\nSource files: ${result.files.length}\nOutput: ${result.destination}${options.check ? ' (not created)' : '\nUpload the whole directory; see COMMANDS.txt.'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { console.error(`OneAPI release failed: ${error.message}`); process.exitCode = 1 }
}
