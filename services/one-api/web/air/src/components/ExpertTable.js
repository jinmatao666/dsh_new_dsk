import React, { useEffect, useRef, useState } from 'react';
import { Building2, FileText, Layers3, Leaf, Map, MessagesSquare, Scale } from 'lucide-react';
import { API, showError, showSuccess } from '../helpers';
import './ExpertTable.css';

const readArray = value => {
  try { const result = JSON.parse(value || '[]'); return Array.isArray(result) ? result : []; }
  catch { return []; }
};

const SKILL_LABELS = {
  'market-gis-geology-analysis': '地质条件分析',
  'market-gis-third-survey-analysis': '三调土地利用现状分析',
  'market-gis-land-use-plan-review': '土地利用规划审查',
  'office-word-to-pdf': 'Word 转 PDF',
  'office-pdf-to-images': 'PDF 转图片',
  'office-pdf-organizer': 'PDF 合并拆分',
  'office-images-to-pdf': '图片转 PDF',
  'office-image-optimizer': '图片压缩与格式转换',
  'office-document-summary': '文档摘要与要点提取',
  'office-document-compare': '文档对比助手',
  'office-meeting-minutes': '会议纪要'
};

const defaultSections = item => [
  { title: '适用场景', subtitle: '场景应用', content: item.scenario || '' },
  { title: '需要准备的材料', subtitle: '材料要求', content: item.materials || '' },
  { title: item.key === 'meeting-minutes' ? '本专家交付' : '交付成果', subtitle: '输出内容', content: '' },
  { title: item.key === 'geology-analysis' || item.key === 'third-survey-analysis' || item.key === 'land-use-plan-review' ? '专业方向' : '处理原则', subtitle: '能力范围', content: readArray(item.tags).join('\n') }
];
const readSections = item => {
  try {
    const parsed = JSON.parse(item.detail_sections || '[]');
    if (Array.isArray(parsed) && parsed.length === 4) return parsed.map(section => ({ title: String(section.title || ''), subtitle: String(section.subtitle || ''), content: String(section.content || '') }));
  } catch { /* Fall back to the existing profile fields. */ }
  return defaultSections(item);
};

const EXPERT_ICONS = [
  { value: 'gis', label: '地质地图', Icon: Map },
  { value: 'survey', label: '调查图层', Icon: Layers3 },
  { value: 'planning', label: '空间规划', Icon: Building2 },
  { value: 'meeting', label: '会议协作', Icon: MessagesSquare },
  { value: 'policy', label: '政策文件', Icon: Scale },
  { value: 'ecology', label: '生态保护', Icon: Leaf },
  { value: 'property', label: '不动产', Icon: Building2 },
  { value: 'writing', label: '文档处理', Icon: FileText }
];
const defaultIcon = key => key === 'meeting-minutes' ? 'meeting' : key === 'third-survey-analysis' ? 'survey' : key === 'land-use-plan-review' ? 'planning' : key === 'file-conversion-pdf' || key === 'document-intelligence' ? 'writing' : 'gis';
const IconPreview = ({ value }) => {
  if (String(value || '').startsWith('data:image/')) return <img src={value} alt='' />;
  const preset = EXPERT_ICONS.find(item => item.value === value) || EXPERT_ICONS[0];
  const Icon = preset.Icon;
  return <Icon aria-hidden='true' />;
};

export default function ExpertTable() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const iconInputRef = useRef(null);
  const chooseIconFile = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { showError('请选择 PNG、JPEG、WebP 或 GIF 图片'); return; }
    if (file.size > 2 * 1024 * 1024) { showError('图标文件不能超过 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => setEditing(current => current ? { ...current, icon: String(reader.result || '') } : current);
    reader.onerror = () => showError('读取图标失败');
    reader.readAsDataURL(file);
  };
  const load = async () => {
    try {
      const experts = await API.get('/api/expert/admin/list');
      if (!experts.data?.success) throw new Error(experts.data?.message || '无法读取专家列表');
      setItems(experts.data.data || []);
      try {
        const categoryList = await API.get('/api/expert/admin/categories');
        setCategories(categoryList.data?.data || []);
      } catch { setCategories([]); }
    } catch (error) { showError(error.message || '无法读取专家列表'); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = { ...editing, detail_sections: JSON.stringify(editing.detailSections) };
      delete payload.detailSections;
      const result = await API.put(`/api/expert/admin/${encodeURIComponent(editing.key)}`, payload);
      if (!result.data?.success) throw new Error(result.data?.message || '保存失败');
      showSuccess(editing.published ? '专家资料已保存并上架' : '专家资料已保存');
      setEditing(null);
      await load();
    } catch (error) { showError(error.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const togglePublished = async item => {
    try {
      const next = !item.published;
      const result = await API.put(`/api/expert/admin/${encodeURIComponent(item.key)}/publish`, { published: next });
      if (!result.data?.success) throw new Error(result.data?.message || '操作失败');
      showSuccess(next ? '专家已上架' : '专家已下架');
      await load();
    } catch (error) { showError(error.response?.data?.message || error.message || '操作失败'); }
  };

  return <section className='expert-admin preview-surface'>
    <div className='expert-admin-head'><div><h2>专家工作台</h2><p>只列出当前版本已开发的工作台。上架后，用户才会在桌面端看到对应专家。</p></div><span>{items.length} 个已开发</span></div>
    <div className='expert-admin-list'>{items.map(item => <article key={item.key}>
      <div className='expert-admin-icon' aria-label='专家图标'><IconPreview value={item.icon} /></div><div className='expert-admin-info'><strong>{item.name}</strong><small>{item.subtitle}</small><p>{item.summary}</p></div>
      <span className={item.published ? 'expert-admin-live' : 'expert-admin-draft'}>{item.published ? '已上架' : '未上架'}</span>
      <div className='expert-admin-actions'><button type='button' className={item.published ? 'unpublish' : 'publish'} onClick={() => void togglePublished(item)}>{item.published ? '下架' : '上架'}</button><button type='button' onClick={() => setEditing({ ...item, detailSections: readSections(item) })}>管理</button></div>
    </article>)}</div>
    {editing && <div className='expert-admin-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><section className='expert-admin-dialog' role='dialog' aria-modal='true' aria-label='管理专家'>
      <header><div><h2>管理{editing.name}</h2><p>工作台页面和分析流程由桌面端代码提供；这里仅管理展示资料。</p></div><button type='button' onClick={() => setEditing(null)} aria-label='关闭'>×</button></header>
      <div className='expert-admin-fields'>
        <label>专家名称<input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <label>副标题<input value={editing.subtitle} onChange={event => setEditing({ ...editing, subtitle: event.target.value })} /></label>
        <label>分类<select value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value })}><option value=''>请选择分类</option>{categories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
        <div className='wide expert-admin-icon-picker'><span>专家图标</span><div className='expert-admin-icon-options'>{EXPERT_ICONS.map(({ value, label, Icon }) => <button type='button' key={value} className={editing.icon === value ? 'selected' : ''} onClick={() => setEditing({ ...editing, icon: value })} title={label}><Icon/><small>{label}</small></button>)}</div><div className='expert-admin-icon-field'><span className='expert-admin-icon preview'><IconPreview value={editing.icon} /></span><button type='button' className='preview-button' onClick={() => iconInputRef.current?.click()}>上传自定义图标</button>{editing.icon !== defaultIcon(editing.key) && <button type='button' className='preview-button' onClick={() => setEditing({ ...editing, icon: defaultIcon(editing.key) })}>恢复默认</button>}</div><input ref={iconInputRef} hidden type='file' accept='image/png,image/jpeg,image/webp,image/gif' onChange={chooseIconFile} /><small>常用图标和上传图标会同步用于市场卡片、介绍弹窗和专家工作台。支持 PNG、JPEG、WebP 或 GIF，最大 2 MB。</small></div>
        <label className='wide'>市场简介<textarea value={editing.summary} onChange={event => setEditing({ ...editing, summary: event.target.value })} /></label>
        <label className='wide'>标签（每行一个）<textarea value={readArray(editing.tags).join('\n')} onChange={event => setEditing({ ...editing, tags: JSON.stringify(event.target.value.split('\n').map(text => text.trim()).filter(Boolean)) })} /></label>
        <div className='wide expert-detail-editor'><div className='expert-detail-editor-head'><strong>介绍弹窗内容</strong><small>四个区块的标题、副标题和正文会同步到桌面端。</small></div>{editing.detailSections.map((section, index) => <section key={index}><span>{index + 1}</span><div><label>区块标题<input value={section.title} onChange={event => setEditing({ ...editing, detailSections: editing.detailSections.map((value, position) => position === index ? { ...value, title: event.target.value } : value) })}/></label><label>区块副标题<input value={section.subtitle} onChange={event => setEditing({ ...editing, detailSections: editing.detailSections.map((value, position) => position === index ? { ...value, subtitle: event.target.value } : value) })}/></label><label className='wide'>区块内容<textarea value={section.content} onChange={event => setEditing({ ...editing, detailSections: editing.detailSections.map((value, position) => position === index ? { ...value, content: event.target.value } : value) })}/></label></div></section>)}</div>
        <fieldset className='wide expert-admin-skill-readonly'><legend>实际调用技能</legend><div>{readArray(editing.related_skills).map(skill => <span key={skill}>{SKILL_LABELS[skill] || skill}</span>)}</div><small>由工作台代码自动声明，仅用于核对真实执行链路，不能在后台修改。</small></fieldset>
      </div>
      <footer><button type='button' onClick={() => setEditing(null)}>取消</button><button type='button' className='preview-button primary' disabled={saving || !editing.name.trim()} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button></footer>
    </section></div>}
  </section>;
}
