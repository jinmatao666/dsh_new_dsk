import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, Input, Modal, Space, Table } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';

const EMPTY = { id: null, name: '', description: '' };

const SkillCategory = forwardRef(({ embedded = false, keyword = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localKeyword, setLocalKeyword] = useState('');
  const [editor, setEditor] = useState({ visible: false, data: EMPTY });
  const searchKeyword = embedded ? keyword : localKeyword;

  const load = async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/skill-category/', { params: { includeDisabled: 1, type: 'skill_package' } });
      setItems(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (error) {
      showError(error.message || '加载技能分类失败');
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
      if (editor.data.id) await API.put(`/api/skill-category/${editor.data.id}`, payload);
      else await API.post('/api/skill-category/', payload);
      await load();
      window.dispatchEvent(new Event('skill-categories-changed'));
      showSuccess('保存成功');
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const remove = (row) => {
    const skillCount = Number(row.skill_count || 0);
    if (skillCount > 0) {
      showError(`该分类下已绑定 ${skillCount} 个技能，请先调整技能分类后再删除`);
      return;
    }
    Modal.confirm({
      title: `删除分类：${row.name}?`,
      content: '删除后不可恢复。',
      okType: 'danger',
      onOk: async () => {
        await API.delete(`/api/skill-category/${row.id}`);
        await load();
        window.dispatchEvent(new Event('skill-categories-changed'));
        showSuccess('已删除');
      }
    });
  };

  const columns = [
    { title: '分类名称', dataIndex: 'name', width: 240 },
    { title: '描述', dataIndex: 'description', ellipsis: { showTitle: true } },
    { title: '技能数量', dataIndex: 'skill_count', width: 110, render: (value) => Number(value || 0) },
    {
      title: '操作', width: 150,
      render: (_, row) => <Space><Button size='small' type='tertiary' theme='light' onClick={() => setEditor({ visible: true, data: { ...EMPTY, ...row } })}>编辑</Button><Button size='small' type='danger' theme='light' onClick={() => remove(row)}>删除</Button></Space>
    }
  ];
  const filteredItems = useMemo(() => {
    const term = (searchKeyword || '').trim().toLowerCase();
    return term ? items.filter((item) => [item.name, item.description].filter(Boolean).some((value) => String(value).toLowerCase().includes(term))) : items;
  }, [items, searchKeyword]);

  return <div style={{ padding: embedded ? 0 : 24, height: embedded ? '100%' : undefined, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {!embedded && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}><Space><Button icon={<IconPlus />} theme='solid' type='primary' onClick={() => setEditor({ visible: true, data: EMPTY })}>新建分类</Button><Input prefix={<IconSearch />} placeholder='搜索名称或描述' value={localKeyword} onChange={setLocalKeyword} style={{ width: 280 }} showClear /></Space></div>}
    <div style={{ flex: 1, minHeight: 0 }}><Table columns={columns} dataSource={filteredItems} rowKey='id' loading={loading} pagination={{ pageSize: 20 }} /></div>
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
