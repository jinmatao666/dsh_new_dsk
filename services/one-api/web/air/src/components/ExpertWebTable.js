import React, { useEffect, useState } from 'react';
import { API, showError, showSuccess } from '../helpers';
import './ExpertWebTable.css';
import CustomSelect from './CustomSelect';

const blank = { key: '', name: '', subtitle: '', category: '', summary: '', icon: '', tags: '[]', scenario: '', materials: '', detail_sections: '[]', footer_note: '', provider: '', workbench_url: '', sort_order: 0 };
const lines = text => JSON.stringify(text.split('\n').map(item => item.trim()).filter(Boolean));
const asLines = value => { try { return JSON.parse(value || '[]').join('\n'); } catch { return ''; } };
const sectionDefaults = [
  { title: '适用场景', subtitle: '场景应用', content: '' },
  { title: '需要准备的材料', subtitle: '材料要求', content: '' },
  { title: '本专家交付', subtitle: '输出内容', content: '' },
  { title: '处理原则', subtitle: '能力范围', content: '' },
];
const detailSections = expert => {
  try {
    const sections = JSON.parse(expert.detail_sections || '[]');
    if (Array.isArray(sections) && sections.length > 0 && sections.every(section => section && typeof section.title === 'string' && typeof section.subtitle === 'string' && typeof section.content === 'string')) {
      return [...sections, ...sectionDefaults.slice(sections.length)];
    }
  } catch { /* An older record may not contain valid detail sections. */ }
  return sectionDefaults.map((section, index) => ({ ...section, content: index === 0 ? expert.scenario || '' : index === 1 ? expert.materials || '' : index === 2 ? expert.summary || '' : '' }));
};

export default function ExpertWebTable() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [credential, setCredential] = useState('');
  const updateSection = (index, field, value) => setEditing(current => {
    if (!current) return current;
    const sections = detailSections(current).map((section, position) => position === index ? { ...section, [field]: value } : section);
    return { ...current, detail_sections: JSON.stringify(sections) };
  });

  const uploadIcon = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { showError('请选择 PNG、JPEG、WebP 或 GIF 图片'); return; }
    if (file.size > 8 * 1024 * 1024) { showError('图标文件不能超过 8 MB'); return; }
    const key = editing.key;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) { showError('无法处理图标图片'); return; }
        let icon = '';
        for (const maxSide of [256, 192, 128, 96]) {
          const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          icon = canvas.toDataURL('image/webp', 0.8);
          if (icon.length <= 60 * 1024) break;
        }
        if (icon.length > 60 * 1024) { showError('图标压缩后仍然过大，请选择更简单的图片'); return; }
        setEditing(current => current && current.key === key ? { ...current, icon } : current);
      };
      image.onerror = () => showError('读取图标失败');
      image.src = String(reader.result || '');
    };
    reader.onerror = () => showError('读取图标失败');
    reader.readAsDataURL(file);
  };

  const load = async () => {
    try {
      const [experts, categoryResult] = await Promise.all([API.get('/api/expert-web/admin/list'), API.get('/api/expert/admin/categories')]);
      if (!experts.data?.success) throw new Error(experts.data?.message || '无法读取专家');
      setItems(experts.data.data || []);
      setCategories(categoryResult.data?.data || []);
    } catch (error) { showError(error.response?.data?.message || error.message || '读取失败'); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const sections = detailSections(editing);
      const payload = { ...editing, key: editing.key.trim(), name: editing.name.trim(), provider: editing.provider.trim(), workbench_url: editing.workbench_url.trim(), detail_sections: JSON.stringify(sections), scenario: sections[0]?.content || '', materials: sections[1]?.content || '' };
      const response = items.some(item => item.key === payload.key)
        ? await API.put(`/api/expert-web/admin/${encodeURIComponent(payload.key)}`, payload)
        : await API.post('/api/expert-web/admin/', payload);
      if (!response.data?.success) throw new Error(response.data?.message || '保存失败');
      if (response.data.provider_credential) setCredential(response.data.provider_credential);
      setEditing(null);
      showSuccess('专家资料已保存');
      await load();
    } catch (error) { showError(error.response?.data?.message || error.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const publish = async item => {
    try {
      const response = await API.put(`/api/expert-web/admin/${encodeURIComponent(item.key)}/publish`, { published: !item.published });
      if (!response.data?.success) throw new Error(response.data?.message || '操作失败');
      showSuccess(item.published ? '专家已下架' : '专家已上架');
      await load();
    } catch (error) { showError(error.response?.data?.message || error.message || '操作失败'); }
  };

  const rotate = async item => {
    if (!window.confirm(`重新生成「${item.name}」的提供方凭据？旧凭据会立即失效。`)) return;
    try {
      const response = await API.post(`/api/expert-web/admin/${encodeURIComponent(item.key)}/credential`);
      if (!response.data?.success) throw new Error(response.data?.message || '重置失败');
      setCredential(response.data.provider_credential);
    } catch (error) { showError(error.response?.data?.message || error.message || '重置失败'); }
  };

  return <section className='expert-web-admin'>
    <header><div><h2>专家</h2><p>配置卡片、介绍和网站地址。上架后桌面端自动显示；网页功能在各自独立网站中维护。</p></div><button type='button' className='primary' onClick={() => setEditing({ ...blank })}>新增专家</button></header>
    <div className='expert-web-list'>{items.length === 0 && <p className='empty'>还没有专家。先登记网站及提供方，再上架。</p>}{items.map(item => <article key={item.key}>
      <div className='expert-web-icon'>{item.icon?.startsWith('data:image/') ? <img src={item.icon} alt='' /> : '✦'}</div>
      <div className='expert-web-info'><strong>{item.name}</strong><small>{item.key} · {item.provider}</small><p>{item.workbench_url}</p></div>
      <span className={item.published ? 'live' : 'draft'}>{item.published ? '已上架' : '未上架'}</span>
      <div className='actions'><button type='button' onClick={() => setEditing({ ...item })}>编辑</button><button type='button' onClick={() => void rotate(item)}>重置凭据</button><button type='button' onClick={() => void publish(item)}>{item.published ? '下架' : '上架'}</button></div>
    </article>)}</div>
    {editing && <div className='expert-web-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><section className='expert-web-dialog' role='dialog' aria-modal='true' aria-label='专家资料'>
      <header><h2>{items.some(item => item.key === editing.key) ? '编辑专家' : '新增专家'}</h2><button type='button' aria-label='关闭' onClick={() => setEditing(null)}>×</button></header>
      <div className='fields'>
        <label>专家编号<input value={editing.key} disabled={items.some(item => item.key === editing.key)} placeholder='geology-analysis' onChange={event => setEditing({ ...editing, key: event.target.value })} /></label>
        <label>专家名称<input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <label>提供方<input value={editing.provider} onChange={event => setEditing({ ...editing, provider: event.target.value })} /></label>
        <label>分类<CustomSelect aria-label='分类' value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value })}><option value=''>请选择分类</option>{categories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}</CustomSelect></label>
        <label className='wide'>HTTP/HTTPS 工作台地址<input type='url' value={editing.workbench_url} placeholder='http://ac.zjugis.com:3301/' onChange={event => setEditing({ ...editing, workbench_url: event.target.value })} /></label>
        <label>副标题<input value={editing.subtitle} onChange={event => setEditing({ ...editing, subtitle: event.target.value })} /></label>
        <label className='wide'>专家主图标（卡片和介绍弹窗共用）<span className='expert-web-icon-editor'><input type='file' accept='image/png,image/jpeg,image/webp,image/gif' onChange={uploadIcon} />{editing.icon?.startsWith('data:image/') && <img className='expert-web-icon-preview' src={editing.icon} alt='专家图标预览' />}</span><small>上传 PNG、JPEG、WebP 或 GIF；保存后桌面端自动同步。</small></label>
        <label className='wide'>简介<textarea value={editing.summary} onChange={event => setEditing({ ...editing, summary: event.target.value })} /></label>
        <label className='wide'>标签（每行一个）<textarea value={asLines(editing.tags)} onChange={event => setEditing({ ...editing, tags: lines(event.target.value) })} /></label>
        <div className='wide expert-web-section-editor'><h3>介绍弹窗的四块内容</h3><p>卡片使用上方的名称、副标题、简介和标签；这里的内容只显示在点击卡片后的弹窗中。</p><div className='expert-web-section-grid'>{detailSections(editing).map((section, index) => <fieldset key={index}><legend>第 {index + 1} 块</legend><label>标题<input value={section.title} onChange={event => updateSection(index, 'title', event.target.value)} /></label><label>右侧小标题<input value={section.subtitle} onChange={event => updateSection(index, 'subtitle', event.target.value)} /></label><label>正文<textarea value={section.content} onChange={event => updateSection(index, 'content', event.target.value)} /></label></fieldset>)}</div></div>
        <label className='wide'>弹窗底部说明<input value={editing.footer_note || ''} onChange={event => setEditing({ ...editing, footer_note: event.target.value })} placeholder='例如：录音转写和材料整理完成后生成正式纪要' /></label>
      </div>
      <footer><button type='button' onClick={() => setEditing(null)}>取消</button><button type='button' className='primary' disabled={saving || !editing.key.trim() || !editing.name.trim() || !editing.workbench_url.trim()} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button></footer>
    </section></div>}
    {credential && <div className='expert-web-backdrop'><section className='expert-web-secret' role='dialog' aria-modal='true' aria-label='提供方凭据'><h2>请保存提供方凭据</h2><p>只显示这一次。把它配置在专家网站后端，不要放进网页、桌面端或代码仓库。</p><code>{credential}</code><button type='button' className='primary' onClick={() => setCredential('')}>我已保存，关闭</button></section></div>}
  </section>;
}
