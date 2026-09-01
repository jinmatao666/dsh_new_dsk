/**
 * 冒烟校验（非交付物）：mock 数据与 skillDownload.parseAssets 的标记格式对齐。
 * 运行：node scripts/smoke-skill-mock.mjs
 *
 * skillDownload.js 顶层依赖 ../helpers（axios 链），Node 直接 import 过重，
 * 这里按同一份正则复刻 parseAssets/safeRelPath 行为做格式断言。
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mockModulePath = pathToFileURL(join(here, '../src/components/skillMarketplaceMock.js')).href;

// 复刻 skillDownload.js 的 safeRelPath / parseAssets（保持正则一致）
function safeRelPath(relPath) {
  const safe = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!safe || safe.split('/').some(part => part === '..' || part === '.')) return '';
  if (safe.toLowerCase() === 'skill.md') return '';
  return safe;
}
function parseAssets(assets) {
  if (!assets) return [];
  const markers = [];
  const scriptMarkerRe = /^#{1,6}[ \t]*Script:[ \t]*(\S+)[ \t]*\r?\n/gm;
  const fileMarkerRe = /^<!--[ \t]*file:[ \t]*([^\n>]+?)[ \t]*-->[ \t]*\r?\n/gm;
  for (const re of [scriptMarkerRe, fileMarkerRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(assets)) !== null) markers.push({ headerStart: m.index, afterHeader: m.index + m[0].length, relPath: m[1].trim() });
  }
  markers.sort((a, b) => a.headerStart - b.headerStart);
  const files = [];
  const seen = new Set();
  const fenceOpenRe = /^[ \t\r\n]*```([\w+-]*)[ \t]*\r?\n/;
  const closeFenceRe = /^[ \t]*```[ \t]*\r?$/gm;
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const relPath = safeRelPath(marker.relPath);
    if (!relPath || seen.has(relPath)) continue;
    const nextStart = i + 1 < markers.length ? markers[i + 1].headerStart : assets.length;
    const spanAfterHeader = assets.slice(marker.afterHeader, nextStart);
    const fence = spanAfterHeader.match(fenceOpenRe);
    if (!fence) continue;
    const codeStart = marker.afterHeader + fence[0].length;
    const codeRegion = assets.slice(codeStart, nextStart);
    closeFenceRe.lastIndex = 0;
    let lastClose = null;
    let m;
    while ((m = closeFenceRe.exec(codeRegion)) !== null) lastClose = { start: m.index };
    if (!lastClose) continue;
    const raw = codeRegion.slice(0, lastClose.start).replace(/[\r\n]+$/, '');
    files.push({ path: relPath, text: raw });
    seen.add(relPath);
  }
  return files;
}

const { MARKETPLACE_MOCK_SKILLS } = await import(mockModulePath);

const errors = [];
const ids = new Set();
for (const skill of MARKETPLACE_MOCK_SKILLS) {
  if (ids.has(skill.id)) errors.push(`${skill.id}: 重复 id`);
  ids.add(skill.id);
  for (const field of ['display_name', 'category', 'submitter', 'created_at', 'version', 'summary', 'description']) {
    if (!skill[field]) errors.push(`${skill.id}: 缺少字段 ${field}`);
  }
  if (!Array.isArray(skill.capabilities) || skill.capabilities.length === 0) errors.push(`${skill.id}: capabilities 为空`);
  if (!skill.body) errors.push(`${skill.id}: body 为空`);
  const parsed = parseAssets(skill.assets);
  const parsedPaths = new Set(parsed.map(file => file.path));
  for (const path of skill.package_files) {
    if (!parsedPaths.has(path)) errors.push(`${skill.id}: 文件 ${path} 未被 parseAssets 解析`);
  }
  if (parsedPaths.size !== skill.package_files.length) {
    errors.push(`${skill.id}: 解析出 ${parsedPaths.size} 个文件，package_files 声明 ${skill.package_files.length} 个`);
  }
  for (const file of parsed) {
    if (!file.text.trim()) errors.push(`${skill.id}: 文件 ${file.path} 内容为空`);
  }
}

if (MARKETPLACE_MOCK_SKILLS.length !== 29) errors.push(`技能数量 ${MARKETPLACE_MOCK_SKILLS.length}，应为 29（与技能广场对齐）`);

if (errors.length > 0) {
  console.error('SMOKE FAILED');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`SMOKE OK: ${MARKETPLACE_MOCK_SKILLS.length} 个技能全部通过，assets 与 parseAssets 标记格式对齐。`);
