import React, { useEffect, useState } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../helpers';

const empty = { id: null, name: '', description: '', status: 1, sort_order: 0 };

export default function ExpertCategory() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const response = await API.get('/api/expert/admin/categories', { params: { includeDisabled: 1 } });
      if (!response.data?.success) throw new Error(response.data?.message || '加载分类失败');
      setItems(response.data.data || []);
    } catch (error) { showError(error.response?.data?.message || error.message || '加载分类失败'); }
  };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!editing?.name.trim()) return showError('分类名称必填');
    setSaving(true);
    try {
      const payload = { ...editing, name: editing.name.trim(), description: editing.description.trim() };
      const response = editing.id
        ? await API.put(`/api/expert/admin/categories/${editing.id}`, payload)
        : await API.post('/api/expert/admin/categories', payload);
      if (!response.data?.success) throw new Error(response.data?.message || '保存分类失败');
      setEditing(null); await load(); showSuccess('分类已保存');
    } catch (error) { showError(error.response?.data?.message || error.message || '保存分类失败'); }
    finally { setSaving(false); }
  };
  const remove = item => Modal.confirm({
    title: `删除分类：${item.name}?`, content: '仍绑定专家或专家团的分类不能删除。', okType: 'danger',
    onOk: async () => { try { const response = await API.delete(`/api/expert/admin/categories/${item.id}`); if (!response.data?.success) throw new Error(response.data?.message || '删除失败'); await load(); showSuccess('分类已删除'); } catch (error) { showError(error.response?.data?.message || error.message || '删除失败'); } }
  });
  return <div className='expert-category'>
    <div className='expert-category-head'><div><h2>分类管理</h2><p>分类会同步用于桌面端专家和专家团市场筛选。</p></div><button type='button' className='preview-button primary' onClick={() => setEditing({ ...empty })}>＋ 新建分类</button></div>
    <div className='expert-category-table'>
      <div className='expert-category-row header'><span>分类名称</span><span>描述</span><span>专家</span><span>专家团</span><span>状态</span><span>操作</span></div>
      {items.map(item => <div className='expert-category-row' key={item.id}><strong>{item.name}</strong><span>{item.description || '—'}</span><span>{item.expert_count || 0}</span><span>{item.team_count || 0}</span><span className={item.status ? 'enabled' : 'disabled'}>{item.status ? '已启用' : '已禁用'}</span><span><button type='button' onClick={() => setEditing({ ...item })}>编辑</button><button type='button' className='danger' onClick={() => remove(item)}>删除</button></span></div>)}
    </div>
    {editing && <div className='expert-admin-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><section className='expert-admin-dialog' role='dialog' aria-modal='true' aria-label='管理专家分类'><header><h2>{editing.id ? '编辑分类' : '新建分类'}</h2><button type='button' onClick={() => setEditing(null)} aria-label='关闭'>×</button></header><div className='expert-admin-fields'><label className='wide'>分类名称<input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })}/></label><label className='wide'>分类描述<textarea value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })}/></label><label>排序<input type='number' value={editing.sort_order} onChange={event => setEditing({ ...editing, sort_order: Number(event.target.value) })}/></label><label className='expert-admin-publish'><input type='checkbox' checked={editing.status === 1} onChange={event => setEditing({ ...editing, status: event.target.checked ? 1 : 0 })}/>启用分类</label></div><footer><button type='button' onClick={() => setEditing(null)}>取消</button><button type='button' className='preview-button primary' disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存分类'}</button></footer></section></div>}
  </div>;
}
