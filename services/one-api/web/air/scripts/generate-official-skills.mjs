/** Validate official skill bundles and project their metadata into both clients. */

import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const airRoot = resolve(here, '..');
const repositoryRoot = resolve(airRoot, '..', '..', '..', '..');
const skillsRoot = join(airRoot, 'public', 'skills');
const catalogPath = join(skillsRoot, 'catalog.json');
const desktopProjectionPath = join(repositoryRoot, 'packages', 'client', 'ui-skill-marketplace', 'src', 'client', 'official-skills.generated.ts');
const adminProjectionPath = join(airRoot, 'src', 'components', 'officialSkills.generated.mjs');
const check = process.argv.includes('--check');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

const entries = await readdir(skillsRoot, { withFileTypes: true });
const manifests = [];
const seenIds = new Set();
const seenSlugs = new Set();

for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isDirectory()) continue;
  if (!slugPattern.test(entry.name)) throw new Error(`Invalid skill directory name: ${entry.name}`);
  const directory = join(skillsRoot, entry.name);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  validateManifest(manifest, entry.name);
  if (seenIds.has(manifest.id)) throw new Error(`Duplicate skill id: ${manifest.id}`);
  if (seenSlugs.has(manifest.slug)) throw new Error(`Duplicate skill slug: ${manifest.slug}`);
  seenIds.add(manifest.id);
  seenSlugs.add(manifest.slug);
  await validateFiles(directory, manifest.files);
  manifests.push(manifest);
}

if (manifests.length !== 3) throw new Error(`Expected 3 official GIS skills, found ${manifests.length}`);

const catalog = `${JSON.stringify({ schemaVersion: 1, skills: manifests }, null, 2)}\n`;
const desktopSkills = manifests.map(manifest => ({
  id: manifest.id,
  slug: manifest.slug,
  name: manifest.displayName,
  category: manifest.category,
  tags: manifest.tags,
  summary: manifest.summary,
  description: manifest.description,
  installs: '0',
  accent: manifest.accent,
  icon: manifest.icon,
  version: manifest.version,
  author: manifest.author,
  featured: manifest.featured,
  params: manifest.params,
  installable: true,
}));
const desktopProjection = `/** Generated from the checked-in official skill manifests. */\nexport const OFFICIAL_SKILLS = ${formatTypeScriptValue(desktopSkills)} as const\n`;
const adminSkills = manifests.map(manifest => ({
  id: manifest.id,
  name: manifest.slug,
  slug: manifest.slug,
  display_name: manifest.displayName,
  category: manifest.category,
  tags: manifest.tags,
  summary: manifest.summary,
  description: manifest.description,
  capabilities: manifest.capabilities,
  version: manifest.version,
  team: manifest.author,
  submitter: manifest.submitter,
  created_at: manifest.createdAt,
  updated_at: manifest.createdAt,
  downloads: 0,
  status: manifest.status,
  params: manifest.params,
  package_files: manifest.files,
  package_base: `/skills/${manifest.slug}`,
  source: 'official-package',
}));
const adminProjection = `/** Generated from the checked-in official skill manifests. */\nexport const OFFICIAL_SKILLS = ${JSON.stringify(adminSkills, null, 2)};\n`;

await emit(catalogPath, catalog);
await emit(desktopProjectionPath, desktopProjection);
await emit(adminProjectionPath, adminProjection);
console.log(`${check ? 'Verified' : 'Generated'} ${manifests.length} official skill packages.`);

function validateManifest(manifest, directoryName) {
  const requiredStrings = ['id', 'slug', 'displayName', 'summary', 'description', 'category', 'version', 'author', 'submitter', 'createdAt', 'status', 'accent', 'icon'];
  if (manifest.schemaVersion !== 1) throw new Error(`${directoryName}: schemaVersion must be 1`);
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') throw new Error(`${directoryName}: missing ${field}`);
  }
  if (manifest.slug !== directoryName || !slugPattern.test(manifest.slug)) throw new Error(`${directoryName}: slug must match its directory`);
  if (!slugPattern.test(manifest.id)) throw new Error(`${directoryName}: invalid id`);
  if (!semverPattern.test(manifest.version)) throw new Error(`${directoryName}: invalid semver ${manifest.version}`);
  for (const field of ['tags', 'capabilities', 'params', 'files']) {
    if (!Array.isArray(manifest[field])) throw new Error(`${directoryName}: ${field} must be an array`);
  }
  if (!manifest.files.includes('SKILL.md')) throw new Error(`${directoryName}: files must include SKILL.md`);
}

async function validateFiles(directory, files) {
  const seen = new Set();
  for (const path of files) {
    if (typeof path !== 'string' || path === '' || isAbsolute(path)) throw new Error(`${relative(skillsRoot, directory)}: invalid file path ${String(path)}`);
    const segments = path.replaceAll('\\', '/').split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error(`${relative(skillsRoot, directory)}: unsafe file path ${path}`);
    if (seen.has(path)) throw new Error(`${relative(skillsRoot, directory)}: duplicate file ${path}`);
    seen.add(path);
    const target = resolve(directory, ...segments);
    if (target !== directory && !target.startsWith(`${directory}${sep}`)) throw new Error(`${relative(skillsRoot, directory)}: file escapes package ${path}`);
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${relative(skillsRoot, directory)}: file must be a regular file ${path}`);
  }
}

async function emit(path, content) {
  if (check) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== content) throw new Error(`Generated file is stale: ${relative(repositoryRoot, path)}`);
    return;
  }
  await writeFile(path, content, 'utf8');
}

/** Format manifest data as the repository's checked-in TypeScript literal style. */
function formatTypeScriptValue(value, depth = 0) {
  const indentation = '  '.repeat(depth);
  const nestedIndentation = '  '.repeat(depth + 1);
  if (typeof value === 'string') return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t')}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map(entry => `${nestedIndentation}${formatTypeScriptValue(entry, depth + 1)},`).join('\n')}\n${indentation}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([key, entry]) => `${nestedIndentation}'${key.replaceAll("'", "\\'")}': ${formatTypeScriptValue(entry, depth + 1)},`).join('\n')}\n${indentation}}`;
  }
  throw new Error(`Cannot format official skill value of type ${typeof value}`);
}
