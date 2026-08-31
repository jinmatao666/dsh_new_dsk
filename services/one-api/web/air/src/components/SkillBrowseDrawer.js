import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, SideSheet, Spin, Tag, Tree } from '@douyinfe/semi-ui';
import { IconDownload, IconFile, IconFolder } from '@douyinfe/semi-icons';
import { showError, timestamp2string } from '../helpers';
import { buildSkillMd, downloadSkillBlob, downloadSkillZip, fetchSkillFull, parseAssets, sanitizeName, splitContent } from './skillDownload';
import './SkillsTable.css';

const textExt = new Set(['md', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'sh', 'yaml', 'yml', 'toml', 'css', 'html', 'csv', 'xml', 'sql', 'vue', 'rs', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'lua', 'r', 'mjs', 'cjs']);
const imageExt = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const extOf = path => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
const sizeOf = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
// 接口返回 unix 秒，演示数据直接携带 'YYYY-MM-DD HH:mm:ss' 字符串，两种都要能显示。
const formatTime = value => {
  if (value === null || value === undefined || value === '') return '-';
  return typeof value === 'number' ? timestamp2string(value) : String(value);
};

const STATUS_LABELS = { published: '已上架', draft: '草稿', disabled: '已下架' };
const STATUS_COLORS = { published: 'green', draft: 'orange', disabled: 'grey' };

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

export default function SkillBrowseDrawer({ visible, kind, id, skill: skillProp, onClose }) {
  const [loading, setLoading] = useState(false); const [skill, setSkill] = useState(null);
  const [selected, setSelected] = useState('SKILL.md'); const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (!visible || id == null) return undefined;
    let cancelled = false; setLoading(true); setSkill(null); setSelected('SKILL.md');
    if (skillProp) { setSkill(skillProp); setLoading(false); return () => { cancelled = true; }; }
    fetchSkillFull(kind, id).then(value => { if (!cancelled) setSkill(value); })
      .catch(error => showError(error.message || '加载技能失败'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, kind, id, skillProp]);
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
  const download = async () => {
    setDownloading(true);
    try {
      // 列表内已有的完整记录直接本地打包；其余按 kind 走接口取详情后打包。
      if (skillProp) { downloadSkillBlob(skillProp); } else { await downloadSkillZip(kind, id); }
    } catch (error) { showError(error.message || '下载技能失败'); } finally { setDownloading(false); }
  };
  const categories = (skill?.categories || []).map(category => <Tag key={category.id} size='small'>{category.type_name || category.type_code} / {category.name || category.code}</Tag>);
  // 接口返回 categories 数组，演示数据携带单个 category 字段，两种都要能显示。
  const categoryDisplay = categories.length ? categories : (skill?.category ? <Tag size='small' color='blue'>{skill.category}</Tag> : null);
  const statusTag = skill && STATUS_LABELS[skill.status] ? <Tag size='small' color={STATUS_COLORS[skill.status]}>{STATUS_LABELS[skill.status]}</Tag> : null;
  const capabilities = Array.isArray(skill?.capabilities) ? skill.capabilities : [];
  return <SideSheet title={`浏览技能${skill?.display_name || skill?.name ? `：${skill.display_name || skill.name}` : ''}`} visible={visible} onCancel={onClose} width='75%'
    footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Button icon={<IconDownload />} type='tertiary' loading={downloading} onClick={download}>下载 ZIP</Button><Button theme='solid' type='primary' onClick={onClose}>关闭</Button></div>}>
    {loading ? <div style={{ textAlign: 'center', padding: 60 }}><Spin size='large' /></div> : !skill ? <Empty description='暂无数据' /> : <div className='skill-browse'>
      <div className='skill-browse-head'>
        <div style={{ minWidth: 0 }}>
          <div className='skill-browse-title-row'>
            <span className='skill-browse-title'>{skill.display_name || skill.name}</span>
            {statusTag}
            {categoryDisplay}
          </div>
          <div className='skill-browse-sub'>{skill.name}{skill.version ? ` · v${skill.version}` : ''}</div>
        </div>
        <div className='skill-browse-stats'>
          <div><span>上传人</span><strong>{skill.submitter || '-'}</strong></div>
          <div><span>上传时间</span><strong>{formatTime(skill.created_at)}</strong></div>
          <div><span>更新时间</span><strong>{formatTime(skill.updated_at)}</strong></div>
          <div><span>下载次数</span><strong>{String(skill.downloads ?? 0)}</strong></div>
        </div>
      </div>
      <section className='skill-browse-section'>
        <h4>主要能力</h4>
        {capabilities.length > 0
          ? <div className='skill-browse-caps'>{capabilities.map(item => <span key={item} className='skill-cap-tag'>{item}</span>)}</div>
          : null}
        <p>{skill.description || '-'}</p>
      </section>
      <section className='skill-browse-files'>
        <div className='skill-browse-filetree'>
          <Tree treeData={treeData(sanitizeName(skill.name), files)} defaultExpandAll value={`file:${selected}`} onChange={value => { if (typeof value === 'string' && value.startsWith('file:')) setSelected(value.slice(5)); }} />
        </div>
        <div className='skill-browse-preview'>
          {!preview ? <Empty description='暂无预览' /> : preview.type === 'image' ? <img src={preview.url} alt={selected} /> : preview.type === 'text' ? <pre>{preview.text}</pre> : <Empty description={`二进制文件，${sizeOf(preview.size)}，无法预览`} />}
        </div>
      </section>
    </div>}
  </SideSheet>;
}
