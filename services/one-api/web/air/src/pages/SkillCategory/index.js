import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, Input, Modal, Space, Table } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';

const EMPTY = { id: null, name: '', description: '' };
const responseData = (response, fallback) => {
  if (response.data?.success) return response.data.data;
  throw new Error(response.data?.message || fallback);
};

const SkillCategory = forwardRef(({ embedded = false, keyword = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localKeyword, setLocalKeyword] = useState('');
  const [editor, setEditor] = useState({ visible: false, data: EMPTY });
  const [expanded, setExpanded] = useState({ category: null, skills: [], loading: false });
  const searchKeyword = embedded ? keyword : localKeyword;

  const load = async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/skill-category/', { params: { includeDisabled: 1, type: 'skill_package' } });
      const categories = responseData(response, '加载技能分类失败');
      setItems(Array.isArray(categories) ? categories : []);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '加载技能分类失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useImperativeHandle(ref, () => ({ openCreate: () => setEditor({ visible: true, data: EMPTY }), refresh: load }));

  const closeEditor = () => setEditor({ visible: false, data: EMPTY });
  const updateEditor = (field, value) => setEditor((current) => ({ ...current, data: { ...current.data, [field]: value } }));

  const save = async () => {
    if (!editor.data.name.trim()) {
      showError('分类名称必填');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: editor.data.name.trim(), description: editor.data.description.trim() };
      const response = editor.data.id
        ? await API.put(`/api/skill-category/${editor.data.id}`, payload)
        : await API.post('/api/skill-category/', payload);
      responseData(response, '保存分类失败');
      await load();
      window.dispatchEvent(new Event('skill-categories-changed'));
      showSuccess('保存成功');
      closeEditor();
    } catch (error) {
      showError(error.response?.data?.message || error.message || '保存分类失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = (row) => {
    const skillCount = Number(row.skill_count || 0);
    if (skillCount > 0) {
      void expandCategory(row);
      showError(`该分类下已绑定 ${skillCount} 个技能，请先在展开列表中移除关联技能`);
      return;
    }
    Modal.confirm({
      title: `删除分类：${row.name}?`,
      content: '删除后不可恢复。',
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await API.delete(`/api/skill-category/${row.id}`);
          responseData(response, '删除分类失败');
          await load();
          window.dispatchEvent(new Event('skill-categories-changed'));
          showSuccess('已删除');
        } catch (error) {
          showError(error.response?.data?.message || error.message || '删除分类失败');
        }
      }
    });
  };

  const expandCategory = async (row) => {
    if (expanded.category?.id === row.id) {
      setExpanded({ category: null, skills: [], loading: false });
      return;
    }
    setExpanded({ category: row, skills: [], loading: true });
    try {
      const response = await API.get(`/api/skill-category/${row.id}/skills`);
      const skills = responseData(response, '加载关联技能失败');
      setExpanded({ category: row, skills: Array.isArray(skills) ? skills : [], loading: false });
    } catch (error) {
      setExpanded({ category: null, skills: [], loading: false });
      showError(error.response?.data?.message || error.message || '加载关联技能失败');
    }
  };

  const removeSkill = (category, skill) => {
    Modal.confirm({
      title: `移出分类：${skill.display_name || skill.name}`,
      content: `移出“${category.name}”后，该技能将自动归入“通用类”。`,
      okText: '移出',
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await API.delete(`/api/skill-category/${category.id}/skills/${skill.id}`);
          responseData(response, '移除关联技能失败');
          await load();
          window.dispatchEvent(new Event('skill-categories-changed'));
          const refreshed = await API.get(`/api/skill-category/${category.id}/skills`);
          setExpanded({ category, skills: responseData(refreshed, '加载关联技能失败') || [], loading: false });
          showSuccess('已移出分类，并归入通用类');
        } catch (error) {
          showError(error.response?.data?.message || error.message || '移除关联技能失败');
        }
      }
    });
  };

  const columns = [
    { title: '分类名称', dataIndex: 'name', width: 240 },
    { title: '描述', dataIndex: 'description', ellipsis: { showTitle: true } },
    { title: '技能数量', dataIndex: 'skill_count', width: 110, render: (value) => Number(value || 0) },
    {
      title: '操作', width: 220,
      render: (_, row) => <Space><Button size='small' type='tertiary' theme='light' onClick={() => { void expandCategory(row); }}>{expanded.category?.id === row.id ? '收起' : '展开'}</Button><Button size='small' type='tertiary' theme='light' onClick={() => setEditor({ visible: true, data: { ...EMPTY, ...row } })}>编辑</Button><Button size='small' type='danger' theme='light' onClick={() => remove(row)}>删除</Button></Space>
    }
  ];
  const filteredItems = useMemo(() => {
    const term = (searchKeyword || '').trim().toLowerCase();
    return term ? items.filter((item) => [item.name, item.description].filter(Boolean).some((value) => String(value).toLowerCase().includes(term))) : items;
  }, [items, searchKeyword]);

  return <div style={{ padding: embedded ? 0 : 24, height: embedded ? '100%' : undefined, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {!embedded && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}><Space><Button icon={<IconPlus />} theme='solid' type='primary' onClick={() => setEditor({ visible: true, data: EMPTY })}>新建分类</Button><Input prefix={<IconSearch />} placeholder='搜索名称或描述' value={localKeyword} onChange={setLocalKeyword} style={{ width: 280 }} showClear /></Space></div>}
    <div style={{ flex: 1, minHeight: 0 }}>
      <Table columns={columns} dataSource={filteredItems} rowKey='id' loading={loading} pagination={{ pageSize: 20 }} />
      {expanded.category && <section style={{ marginTop: 16, border: '1px solid #d9e6f6', borderRadius: 12, background: '#f9fbff', overflow: 'hidden' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 16px', borderBottom: '1px solid #e3ecf8' }}><div><strong style={{ color: '#1d3658' }}>{expanded.category.name} · 关联技能</strong><span style={{ marginLeft: 8, color: '#7890ad', fontSize: 13 }}>移出后自动归入通用类</span></div><Button size='small' theme='borderless' onClick={() => setExpanded({ category: null, skills: [], loading: false })}>收起</Button></header>
        <div style={{ padding: 12 }}>
          {expanded.loading ? <div style={{ color: '#7890ad' }}>正在加载…</div> : expanded.skills.length === 0 ? <div style={{ color: '#7890ad' }}>该分类暂无关联技能</div> : expanded.skills.map((skill) => <div key={skill.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 6px', borderBottom: '1px solid #edf2f8' }}><div><strong style={{ color: '#294566' }}>{skill.display_name || skill.name}</strong><span style={{ marginLeft: 9, color: '#7890ad', fontSize: 12 }}>{skill.name} · v{skill.version || '-'}</span></div>{expanded.category.name === '通用类' ? <span style={{ color: '#8a9bb1', fontSize: 12 }}>默认分类</span> : <Button size='small' type='danger' theme='light' onClick={() => removeSkill(expanded.category, skill)}>移出分类</Button>}</div>)}
        </div>
      </section>}
    </div>
    {editor.visible && (
      <div className='zjugis-modal-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) closeEditor(); }}>
        <div className='zjugis-modal'>
          <div className='zjugis-modal-head'>
            <h2>{editor.data.id ? '编辑分类' : '新建分类'}</h2>
            <button type='button' onClick={closeEditor} aria-label='关闭'>×</button>
          </div>
          <div className='zjugis-form'>
            <label className='zjugis-field'>
              <span>分类名称<i className='skill-required'>*</i></span>
              <input value={editor.data.name} onChange={(e) => updateEditor('name', e.target.value)} placeholder='例如：空间制图' />
            </label>
            <label className='zjugis-field'>
              <span>描述（可选）</span>
              <textarea rows='4' value={editor.data.description} onChange={(e) => updateEditor('description', e.target.value)} placeholder='说明该分类适用的技能' />
            </label>
            <div className='zjugis-modal-actions'>
              <button type='button' className='preview-button' onClick={closeEditor}>取消</button>
              <button type='button' className='preview-button primary' disabled={saving} onClick={() => { void save(); }}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>;
});

export default SkillCategory;
