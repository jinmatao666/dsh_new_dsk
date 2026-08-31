/**
 * 浏览器端读取 SKILL 文件夹。
 *
 * 以 SKILL.md 为主文档（大小写不敏感，取文件夹第二层），其余文件按
 * `<!-- file: path -->` + 代码围栏拼接进 content：文本文件保留原文，
 * 其它附件转 base64，标记格式与 skillDownload.parseAssets 对齐。
 * 返回的 body / assets 已经前端拆分，保存后浏览抽屉与 ZIP 下载可直接使用。
 */

// 可导入的文本扩展名；其它附件用 base64 fence 打包。
const IMPORT_TEXT_EXTS = new Set([
  'md', 'txt', 'ts', 'js', 'tsx', 'jsx', 'mjs', 'cjs',
  'py', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',
  'json', 'yaml', 'yml', 'toml', 'css', 'html', 'htm', 'xml',
  'sql', 'go', 'rs', 'csv', 'tsv'
]);
const IMPORT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const NOISE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const NOISE_DIRS = new Set(['__macosx', '.git', 'node_modules', '__pycache__']);

const fenceLangForExt = (ext) => ({
  cjs: 'javascript',
  mjs: 'javascript',
  ps1: 'powershell',
  py: 'python',
  sh: 'bash',
  md: 'markdown',
  yml: 'yaml'
}[ext] || ext);

const shouldSkipImportPath = (relPath) => {
  const parts = (relPath || '').split('/').filter(Boolean);
  if (parts.length === 0) return true;
  const last = (parts[parts.length - 1] || '').toLowerCase();
  if (NOISE_NAMES.has(last)) return true;
  return parts.some((part) => {
    const lower = part.toLowerCase();
    return NOISE_DIRS.has(lower) || lower.startsWith('.');
  });
};

const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = reject;
    reader.readAsText(file);
  });

const bytesToBase64 = (bytes) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const readFileBase64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return bytesToBase64(bytes);
};

/**
 * 解析一个 SKILL 文件夹的 File 列表。
 * @returns {Promise<{name: string, displayName: string, description: string,
 *   body: string, assets: string, paths: string[], fileCount: number}>}
 *   name/displayName/description 取自 SKILL.md frontmatter（name 缺省用文件夹名）；
 *   body/assets 为拆分结果；paths 为附件相对路径；fileCount 含 SKILL.md。
 */
export async function importSkillFolder(files) {
  const skillMd = files.find((file) =>
    (file.webkitRelativePath || '').toLowerCase().endsWith('/skill.md')
  );
  if (!skillMd) {
    throw new Error('文件夹中未找到 SKILL.md');
  }

  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (totalSize > IMPORT_MAX_SIZE) {
    throw new Error('文件夹总大小不能超过 5MB');
  }

  let bundled = await readFileText(skillMd);
  // 兼容 CRLF / 老 Mac 的 CR 换行，frontmatter 解析需要统一成 LF
  bundled = bundled.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 解析 frontmatter，提取 name / displayName / description
  let name = '';
  let displayName = '';
  let description = '';
  const fmMatch = bundled.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
    const displayNameMatch = fmMatch[1].match(/^displayName:\s*(.+)$/m);
    const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();
    if (displayNameMatch) displayName = displayNameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
  }
  // 文件夹名兜底当 name（SKILL.md frontmatter 缺 name 时）
  if (!name) {
    name = (skillMd.webkitRelativePath || '').split('/')[0] || '';
  }

  // 附加其它文件：文本按原文，二进制按 base64
  const paths = [];
  for (const file of files) {
    if (file === skillMd) continue;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const rel = (file.webkitRelativePath || file.name).split('/').slice(1).join('/');
    if (shouldSkipImportPath(rel || file.name)) continue;
    if (IMPORT_TEXT_EXTS.has(ext)) {
      const content = await readFileText(file);
      bundled += `\n\n<!-- file: ${rel} -->\n\`\`\`${fenceLangForExt(ext)}\n${content}\n\`\`\``;
    } else {
      const content = await readFileBase64(file);
      bundled += `\n\n<!-- file: ${rel} -->\n\`\`\`base64\n${content}\n\`\`\``;
    }
    paths.push(rel);
  }

  // 前端复刻后端 SplitContent：立刻拆出 body / assets
  const { splitContent } = await import('./skillDownload');
  const { body, assets } = splitContent(bundled);

  return { name, displayName, description, body, assets, paths, fileCount: paths.length + 1 };
}
