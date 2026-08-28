import React, { useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Empty, SideSheet, Spin, Tag, Tree } from '@douyinfe/semi-ui';
import { IconDownload, IconFile, IconFolder } from '@douyinfe/semi-icons';
import { showError, timestamp2string } from '../helpers';
import { buildSkillMd, downloadSkillZip, fetchSkillFull, parseAssets, sanitizeName, splitContent } from './skillDownload';

const textExt = new Set(['md', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'sh', 'yaml', 'yml', 'toml', 'css', 'html', 'csv', 'xml', 'sql', 'vue', 'rs', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'lua', 'r', 'mjs', 'cjs']);
const imageExt = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const extOf = path => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
const sizeOf = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function treeData(name, files) {
  const root = { label: `${name}/`, key: 'root', icon: <IconFolder />, children: [] };
  const folders = new Map([['', root]]);
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    const leaf = parts.pop(); let parent = root; let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!folders.has(path)) {
        const folder = { label: `${part}/`, key: `dir:${path}`, icon: <IconFolder />, children: [] };
        folders.set(path, folder); parent.children.push(folder);
      }
      parent = folders.get(path);
    }
    parent.children.push({ label: leaf, key: `file:${file.path}`, icon: <IconFile />, isLeaf: true });
  }
  return [root];
}

export default function SkillBrowseDrawer({ visible, kind, id, onClose }) {
  const [loading, setLoading] = useState(false); const [skill, setSkill] = useState(null);
  const [selected, setSelected] = useState('SKILL.md'); const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (!visible || id == null) return undefined;
    let cancelled = false; setLoading(true); setSkill(null); setSelected('SKILL.md');
    fetchSkillFull(kind, id).then(value => { if (!cancelled) setSkill(value); })
      .catch(error => showError(error.message || '加载技能失败'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, kind, id]);
  const content = useMemo(() => {
    if (!skill) return { body: '', assets: '' };
    if (skill.assets || !skill.content) return { body: skill.body || skill.content || '', assets: skill.assets || '' };
    const split = splitContent(skill.content); return { body: skill.body || split.body, assets: split.assets };
  }, [skill]);
  const files = useMemo(() => skill ? [{ path: 'SKILL.md', data: new TextEncoder().encode(buildSkillMd(skill, content.body)) }, ...parseAssets(content.assets)] : [], [skill, content]);
  const selectedFile = files.find(file => file.path === selected);
  const preview = useMemo(() => {
    if (!selectedFile) return null; const ext = extOf(selectedFile.path);
    if (imageExt.has(ext)) return { type: 'image', size: selectedFile.data.length, url: URL.createObjectURL(new Blob([selectedFile.data])) };
    if (textExt.has(ext) || !ext) return { type: 'text', size: selectedFile.data.length, text: new TextDecoder().decode(selectedFile.data) };
    return { type: 'binary', size: selectedFile.data.length };
  }, [selectedFile]);
  useEffect(() => () => { if (preview?.type === 'image') URL.revokeObjectURL(preview.url); }, [preview]);
  const download = async () => { setDownloading(true); try { await downloadSkillZip(kind, id); } catch (error) { showError(error.message || '下载技能失败'); } finally { setDownloading(false); } };
  const categories = (skill?.categories || []).map(category => <Tag key={category.id} size='small'>{category.type_name || category.type_code} / {category.name || category.code}</Tag>);
  return <SideSheet title={`浏览技能${skill?.name ? `：${skill.name}` : ''}`} visible={visible} onCancel={onClose} width='75%'
    footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Button icon={<IconDownload />} loading={downloading} onClick={download}>下载 ZIP</Button><Button theme='solid' type='primary' onClick={onClose}>关闭</Button></div>}>
    {loading ? <div style={{ textAlign: 'center', padding: 60 }}><Spin size='large' /></div> : !skill ? <Empty description='暂无数据' /> : <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Descriptions size='small' row data={[['名称', skill.name], ['显示名称', skill.display_name || '-'], ['版本', skill.version || '-'], ['上传人', skill.submitter || '-'], ['上传时间', skill.created_at ? timestamp2string(skill.created_at) : '-'], ['更新时间', skill.updated_at ? timestamp2string(skill.updated_at) : '-'], ['下载次数', String(skill.downloads ?? 0)], ['分类', categories.length ? categories : '-']].map(([key, value]) => ({ key, value }))} />
      <section><h4>主要能力</h4><p>{skill.description || '-'}</p></section>
      <section style={{ display: 'flex', gap: 12, minHeight: 380 }}><div style={{ width: 260, flexShrink: 0, border: '1px solid var(--semi-color-border)', borderRadius: 6, overflow: 'auto', padding: 8 }}><Tree treeData={treeData(sanitizeName(skill.name), files)} defaultExpandAll value={`file:${selected}`} onChange={value => { if (typeof value === 'string' && value.startsWith('file:')) setSelected(value.slice(5)); }} /></div><div style={{ flex: 1, minWidth: 0, border: '1px solid var(--semi-color-border)', borderRadius: 6, overflow: 'auto', padding: 12 }}>{!preview ? <Empty description='暂无预览' /> : preview.type === 'image' ? <img src={preview.url} alt={selected} style={{ maxWidth: '100%' }} /> : preview.type === 'text' ? <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview.text}</pre> : <Empty description={`二进制文件，${sizeOf(preview.size)}，无法预览`} />}</div></section>
    </div>}
  </SideSheet>;
}
