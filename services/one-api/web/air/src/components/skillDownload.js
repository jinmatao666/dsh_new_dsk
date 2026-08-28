import { API } from '../helpers';

const encoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const out = new Uint8Array(2);
  const view = new DataView(out.buffer);
  view.setUint16(0, value, true);
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  const view = new DataView(out.buffer);
  view.setUint32(0, value >>> 0, true);
  return out;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const data = file.data;
    const crc = crc32(data);
    const localHeader = [
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(time),
      u16(day),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes
    ];
    const localSize = localHeader.reduce((sum, part) => sum + part.length, 0) + data.length;
    localParts.push(...localHeader, data);

    centralParts.push(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(time),
      u16(day),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    );
    offset += localSize;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0)
  ];

  return new Blob([...localParts, ...centralParts, ...end], { type: 'application/zip' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sanitizeName(name) {
  return (name || 'skill').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 120) || 'skill';
}

function yamlValue(value) {
  const text = String(value ?? '');
  if (!text || /[:#{}[\],&*?|>!%@`"'\n]/.test(text) || text.trim() !== text) {
    return JSON.stringify(text);
  }
  return text;
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function buildSkillMd(skill, body) {
  const content = body || skill.body || skill.content || '';
  if (/^---\r?\n/.test(content)) return ensureTrailingNewline(content);

  const lines = [
    '---',
    `name: ${yamlValue(skill.name)}`,
    `description: ${yamlValue(skill.description || '')}`
  ];
  if (skill.display_name) lines.push(`displayName: ${yamlValue(skill.display_name)}`);
  if (skill.scenario) lines.push(`scenario: ${yamlValue(skill.scenario)}`);
  lines.push('---', '', content.trim());
  return ensureTrailingNewline(lines.join('\n'));
}

export function safeRelPath(relPath) {
  const safe = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!safe || safe.split('/').some((part) => part === '..' || part === '.')) return '';
  if (safe.toLowerCase() === 'skill.md') return '';
  return safe;
}

function base64ToBytes(text) {
  const binary = atob(String(text || '').replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function splitContent(content) {
  if (!content) return { body: '', assets: '' };
  const markers = [];
  const scriptMarkerRe = /^#{1,6}[ \t]*Script:[ \t]*(\S+)[ \t]*\r?\n/gm;
  const fileMarkerRe = /^<!--[ \t]*file:[ \t]*([^\n>]+?)[ \t]*-->[ \t]*\r?\n/gm;
  for (const re of [scriptMarkerRe, fileMarkerRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      markers.push({ headerStart: m.index, afterHeader: m.index + m[0].length, relPath: m[1].trim() });
    }
  }
  markers.sort((a, b) => a.headerStart - b.headerStart);
  if (!markers.length) return { body: content, assets: '' };

  const fenceOpenRe = /^[ \t\r\n]*```[\w+-]*[ \t]*\r?\n/;
  const closeFenceRe = /^[ \t]*```[ \t]*\r?$/gm;
  const bodyParts = [];
  const assetParts = [];
  let cursor = 0;

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const nextStart = i + 1 < markers.length ? markers[i + 1].headerStart : content.length;
    const spanAfterHeader = content.slice(marker.afterHeader, nextStart);
    const fence = spanAfterHeader.match(fenceOpenRe);
    if (!fence) continue;
    const codeStart = marker.afterHeader + fence[0].length;
    const codeRegion = content.slice(codeStart, nextStart);
    closeFenceRe.lastIndex = 0;
    let lastClose = null;
    let m;
    while ((m = closeFenceRe.exec(codeRegion)) !== null) {
      lastClose = { end: m.index + m[0].length };
    }
    if (!lastClose) continue;
    const blockEnd = codeStart + lastClose.end;
    bodyParts.push(content.slice(cursor, marker.headerStart));
    assetParts.push(content.slice(marker.headerStart, blockEnd).replace(/[\r\n]+$/, ''));
    cursor = blockEnd;
  }

  if (!assetParts.length) return { body: content, assets: '' };
  bodyParts.push(content.slice(cursor));
  return {
    body: `${bodyParts.join('').replace(/\n{3,}/g, '\n\n').replace(/[\r\n]+$/, '')}\n`,
    assets: assetParts.join('\n\n')
  };
}

export function parseAssets(assets) {
  if (!assets) return [];
  const markers = [];
  const scriptMarkerRe = /^#{1,6}[ \t]*Script:[ \t]*(\S+)[ \t]*\r?\n/gm;
  const fileMarkerRe = /^<!--[ \t]*file:[ \t]*([^\n>]+?)[ \t]*-->[ \t]*\r?\n/gm;
  for (const re of [scriptMarkerRe, fileMarkerRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(assets)) !== null) {
      markers.push({ headerStart: m.index, afterHeader: m.index + m[0].length, relPath: m[1].trim() });
    }
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
    const lang = (fence[1] || '').toLowerCase();
    const codeStart = marker.afterHeader + fence[0].length;
    const codeRegion = assets.slice(codeStart, nextStart);
    closeFenceRe.lastIndex = 0;
    let lastClose = null;
    let m;
    while ((m = closeFenceRe.exec(codeRegion)) !== null) {
      lastClose = { start: m.index };
    }
    if (!lastClose) continue;
    const raw = codeRegion.slice(0, lastClose.start).replace(/[\r\n]+$/, '');
    files.push({
      path: relPath,
      data: lang === 'base64' ? base64ToBytes(raw) : encoder.encode(raw)
    });
    seen.add(relPath);
  }

  return files;
}

export async function fetchSkillFull(kind, id) {
  const url = kind === 'public' ? `/api/skill/admin/${id}` : `/api/personal-skill/admin/${id}`;
  const res = await API.get(url);
  if (res.data?.success === false) throw new Error(res.data.message || '加载 skill 失败');
  return res.data?.data || res.data;
}

export async function downloadSkillZip(kind, id) {
  const skill = await fetchSkillFull(kind, id);
  if (!skill?.name) throw new Error('skill 数据缺少 name');

  let body = skill.body || '';
  let assets = skill.assets || '';
  if (!assets && skill.content) {
    const split = splitContent(skill.content);
    body = body || split.body;
    assets = split.assets;
  }
  if (!body) body = skill.content || '';

  const root = `${sanitizeName(skill.name)}/`;
  const files = [
    { path: `${root}SKILL.md`, data: encoder.encode(buildSkillMd(skill, body)) },
    ...parseAssets(assets).map((file) => ({
      ...file,
      path: `${root}${file.path}`
    }))
  ];
  const zip = createZip(files);
  downloadBlob(zip, `${sanitizeName(skill.name)}.zip`);
}
