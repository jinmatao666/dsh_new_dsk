import React, { useEffect, useState } from 'react';
import { API, showError, showSuccess } from '../helpers';
import './ExpertTable.css';

const readArray = value => {
  try { const result = JSON.parse(value || '[]'); return Array.isArray(result) ? result : []; }
  catch { return []; }
};

export default function ExpertTable() {
  const [items, setItems] = useState([]);
  const [skills, setSkills] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const experts = await API.get('/api/expert/admin/list');
      if (!experts.data?.success) throw new Error(experts.data?.message || '无法读取专家列表');
      setItems(experts.data.data || []);
      try {
        const skillList = await API.get('/api/skill/admin/list', { params: { page: 1, perPage: 100 } });
        setSkills(skillList.data?.items || []);
      } catch { setSkills([]); }
    } catch (error) { showError(error.message || '无法读取专家列表'); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const result = await API.put(`/api/expert/admin/${encodeURIComponent(editing.key)}`, editing);
      if (!result.data?.success) throw new Error(result.data?.message || '保存失败');
      showSuccess(editing.published ? '专家资料已保存并上架' : '专家资料已保存');
      setEditing(null);
      await load();
    } catch (error) { showError(error.message || '保存失败'); }
    finally { setSaving(false); }
  };

  return <section className='expert-admin preview-surface'>
    <div className='expert-admin-head'><div><h2>专家工作台</h2><p>只列出当前版本已开发的工作台。上架后，用户才会在桌面端看到对应专家。</p></div><span>{items.length} 个已开发</span></div>
    <div className='expert-admin-list'>{items.map(item => <article key={item.key}>
      <div className='expert-admin-icon' aria-label={item.icon === 'survey' ? '勘查图标' : item.icon === 'planning' ? '规划图标' : '地质图标'}>{item.icon === 'survey' ? '◎' : item.icon === 'planning' ? '⌂' : '◇'}</div><div className='expert-admin-info'><strong>{item.name}</strong><small>{item.subtitle}</small><p>{item.summary}</p></div>
      <span className={item.published ? 'expert-admin-live' : 'expert-admin-draft'}>{item.published ? '已上架' : '未上架'}</span>
      <button type='button' onClick={() => setEditing({ ...item })}>管理</button>
    </article>)}</div>
    {editing && <div className='expert-admin-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><section className='expert-admin-dialog' role='dialog' aria-modal='true' aria-label='管理专家'>
      <header><div><h2>管理{editing.name}</h2><p>工作台页面和分析流程由桌面端代码提供；这里仅管理展示资料。</p></div><button type='button' onClick={() => setEditing(null)} aria-label='关闭'>×</button></header>
      <div className='expert-admin-fields'>
        <label>专家名称<input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <label>副标题<input value={editing.subtitle} onChange={event => setEditing({ ...editing, subtitle: event.target.value })} /></label>
        <label>分类<input value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value })} /></label>
        <label>图标<select value={editing.icon} onChange={event => setEditing({ ...editing, icon: event.target.value })}><option value='gis'>地质图</option><option value='survey'>勘查</option><option value='planning'>规划</option></select></label>
        <label className='wide'>市场简介<textarea value={editing.summary} onChange={event => setEditing({ ...editing, summary: event.target.value })} /></label>
        <label className='wide'>标签（每行一个）<textarea value={readArray(editing.tags).join('\n')} onChange={event => setEditing({ ...editing, tags: JSON.stringify(event.target.value.split('\n').map(text => text.trim()).filter(Boolean)) })} /></label>
        <label className='wide'>弹窗：适用场景<textarea value={editing.scenario} onChange={event => setEditing({ ...editing, scenario: event.target.value })} /></label>
        <label className='wide'>弹窗：准备材料<textarea value={editing.materials} onChange={event => setEditing({ ...editing, materials: event.target.value })} /></label>
        <fieldset className='wide'><legend>关联技能（可不选；仅作管理说明，不改变实际分析流程）</legend><div className='expert-admin-skills'>{skills.map(skill => <label key={skill.id}><input type='checkbox' checked={readArray(editing.related_skills).includes(skill.name)} onChange={event => { const previous = readArray(editing.related_skills); setEditing({ ...editing, related_skills: JSON.stringify(event.target.checked ? [...previous, skill.name] : previous.filter(name => name !== skill.name)) }); }} />{skill.display_name || skill.name}</label>)}</div></fieldset>
        <label className='wide expert-admin-publish'><input type='checkbox' checked={editing.published} onChange={event => setEditing({ ...editing, published: event.target.checked })} />上架到桌面端专家库</label>
      </div>
      <footer><button type='button' onClick={() => setEditing(null)}>取消</button><button type='button' className='preview-button primary' disabled={saving || !editing.name.trim()} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button></footer>
    </section></div>}
  </section>;
}
