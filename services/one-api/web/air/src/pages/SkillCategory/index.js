import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button, Input, Modal, Space, Table } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';

const EMPTY = { id: null, name: '', description: '' };
const useSkillMockData = process.env.NODE_ENV === 'development'
  && process.env.REACT_APP_USE_SKILL_MOCK_DATA === 'true';
const loadMockCategorySkills = (category) => {
  const { MARKETPLACE_MOCK_SKILLS } = require('../../components/skillMarketplaceMock');
  return MARKETPLACE_MOCK_SKILLS.filter((skill) => {
    const mockCategory = skill.id === 'spatial-econometrics' ? '其他' : skill.category;
    return mockCategory === category.name;
  });
};
const responseData = (response, fallback) => {
  if (response.data?.success) return response.data.data;
  throw new Error(response.data?.message || fallback);
};
const categoryRowKey = (category) => `${category.type_code || category.type_id || 'category'}:${category.code || category.name}:${category.id}`;
const isDefaultCategory = (category) => category.is_default === true;

const SkillCategory = forwardRef(({ embedded = false, keyword = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localKeyword, setLocalKeyword] = useState('');
  const [editor, setEditor] = useState({ visible: false, data: EMPTY });
  const [expanded, setExpanded] = useState({ key: null, category: null, skills: [], loading: false });
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);
  const expandRequest = useRef(0);
  const searchKeyword = embedded ? keyword : localKeyword;

  const load = async () => {
    if (useSkillMockData) {
      const { SKILL_CATEGORIES_MOCK } = require('../../components/skillCategoryMock');
      setItems(SKILL_CATEGORIES_MOCK.filter((category) => category.type_id === 1));
      return;
    }
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
    if (useSkillMockData) {
      showError('演示数据仅用于本地预览，不能保存修改');
      return;
    }
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
    if (useSkillMockData) {
      showError('演示数据仅用于本地预览，不能删除');
      return;
    }
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
    const key = categoryRowKey(row);
    const request = ++expandRequest.current;
    if (expanded.key === key) {
      setExpanded({ key: null, category: null, skills: [], loading: false });
      return;
    }
    if (useSkillMockData) {
      setExpanded({ key, category: row, skills: loadMockCategorySkills(row), loading: false });
      return;
    }
    setExpanded({ key, category: row, skills: [], loading: true });
    try {
      const response = await API.get(`/api/skill-category/${row.id}/skills`);
      const skills = responseData(response, '加载关联技能失败');
      if (request !== expandRequest.current) return;
      setExpanded({ key, category: row, skills: Array.isArray(skills) ? skills : [], loading: false });
    } catch (error) {
      if (request !== expandRequest.current) return;
      setExpanded({ key: null, category: null, skills: [], loading: false });
      showError(error.response?.data?.message || error.message || '加载关联技能失败');
    }
  };

  const removeSkill = (category, skill) => {
    setRemoveTarget({ category, skill, key: categoryRowKey(category) });
  };

  const confirmRemoveSkill = async () => {
    if (!removeTarget || removing) return;
    const { category, skill, key } = removeTarget;
    setRemoving(true);
    try {
      if (useSkillMockData) {
        setExpanded((current) => current.key === key
          ? { ...current, skills: current.skills.filter((item) => item.id !== skill.id) }
          : current);
        setItems((current) => current.map((item) => categoryRowKey(item) === key
          ? { ...item, skill_count: Math.max(0, Number(item.skill_count || 0) - 1) }
          : item.name === '通用类'
            ? { ...item, skill_count: Number(item.skill_count || 0) + 1 }
            : item));
      } else {
        const response = await API.delete(`/api/skill-category/${category.id}/skills/${skill.id}`, {
          params: { category_name: category.name }
        });
        responseData(response, '移除关联技能失败');
        await load();
        window.dispatchEvent(new Event('skill-categories-changed'));
        const refreshed = await API.get(`/api/skill-category/${category.id}/skills`);
        setExpanded({ key, category, skills: responseData(refreshed, '加载关联技能失败') || [], loading: false });
      }
      setRemoveTarget(null);
      showSuccess('已移出分类，并归入通用类');
    } catch (error) {
      showError(error.response?.data?.message || error.message || '移除关联技能失败');
    } finally {
      setRemoving(false);
    }
  };

  const renderExpandedSkills = (row) => {
    if (expanded.key !== categoryRowKey(row)) return null;
    return <div className='skill-category-skills'>
      {expanded.loading || expanded.skills.length === 0
        ? <div className='skill-category-skills-empty'>{expanded.loading ? '正在加载关联技能…' : '该分类暂无关联技能'}</div>
        : <div className='skill-category-skill-list'>
          {expanded.skills.map((skill) => (
            <div key={skill.id} className='skill-category-skill-row'>
              <div className='skill-category-skill-info'>
                <strong>{skill.display_name || skill.name}</strong>
                <span>{skill.name} · v{skill.version || '-'}</span>
              </div>
              {isDefaultCategory(row)
                ? <span className='skill-category-default-tag'>默认分类</span>
                : <button type='button' className='skill-text-action danger' onClick={() => removeSkill(row, skill)}>移出分类</button>}
            </div>
          ))}
        </div>}
    </div>;
  };

  const columns = [
    {
      title: '分类名称', dataIndex: 'name', width: 240,
      render: (value, row) => (
        <div className='skill-category-name'>
          <button type='button' className={`skill-category-expand${expanded.key === categoryRowKey(row) ? ' open' : ''}`} aria-label={expanded.key === categoryRowKey(row) ? '收起分类技能' : '展开分类技能'} onClick={() => { void expandCategory(row); }}>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='m6 9 6 6 6-6' /></svg>
          </button>
          <span className='skill-category-title'>{value}</span>
        </div>
      )
    },
    { title: '描述', dataIndex: 'description', ellipsis: { showTitle: true } },
    { title: '技能数量', dataIndex: 'skill_count', width: 110, render: (value) => <span className='skill-category-count'>{Number(value || 0)}</span> },
    {
      title: '操作', width: 146,
      render: (_, row) => (
        <div className='skill-row-actions'>
          <button type='button' className='skill-text-action' onClick={() => setEditor({ visible: true, data: { ...EMPTY, ...row } })}>编辑</button>
          {isDefaultCategory(row)
            ? <span className='skill-category-default-tag'>默认分类</span>
            : <button type='button' className='skill-text-action danger' onClick={() => remove(row)}>删除</button>}
        </div>
      )
    }
  ];
  const filteredItems = useMemo(() => {
    const term = (searchKeyword || '').trim().toLowerCase();
    const visible = term ? items.filter((item) => [item.name, item.description].filter(Boolean).some((value) => String(value).toLowerCase().includes(term))) : items;
    return visible.map((item) => ({ ...item, row_key: categoryRowKey(item) }));
  }, [items, searchKeyword]);

  return <div style={{ padding: embedded ? 0 : 24, height: embedded ? '100%' : undefined, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {!embedded && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}><Space><Button icon={<IconPlus />} theme='solid' type='primary' onClick={() => setEditor({ visible: true, data: EMPTY })}>新建分类</Button><Input prefix={<IconSearch />} placeholder='搜索名称或描述' value={localKeyword} onChange={setLocalKeyword} style={{ width: 280 }} showClear /></Space></div>}
    <div style={{ flex: 1, minHeight: 0 }}>
      <Table columns={columns} dataSource={filteredItems} rowKey='row_key' loading={loading} pagination={{ pageSize: 20 }} expandedRowRender={renderExpandedSkills} expandedRowKeys={expanded.key ? [expanded.key] : []} expandIcon={false} />
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
              <input disabled={isDefaultCategory(editor.data)} value={editor.data.name} onChange={(e) => updateEditor('name', e.target.value)} placeholder='例如：空间制图' />
              {isDefaultCategory(editor.data) && <small className='skill-field-hint'>默认分类名称不可修改</small>}
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
    {removeTarget && (
      <div className='zjugis-modal-backdrop' onMouseDown={(event) => { if (!removing && event.target === event.currentTarget) setRemoveTarget(null); }}>
        <div className='zjugis-modal skill-category-confirm-modal' role='dialog' aria-modal='true' aria-labelledby='remove-skill-title'>
          <div className='zjugis-modal-head'>
            <div className='skill-category-confirm-heading'>
              <span className='skill-category-confirm-icon' aria-hidden='true'>!</span>
              <div>
                <h2 id='remove-skill-title'>移出分类</h2>
                <p>调整技能所属分类</p>
              </div>
            </div>
            <button type='button' disabled={removing} onClick={() => setRemoveTarget(null)} aria-label='关闭'>×</button>
          </div>
          <div className='skill-category-confirm-body'>
            <strong>{removeTarget.skill.display_name || removeTarget.skill.name}</strong>
            <p>将从“{removeTarget.category.name}”移出，并自动归入默认分类“通用类”。</p>
          </div>
          <div className='zjugis-modal-actions'>
            <button type='button' className='preview-button' disabled={removing} onClick={() => setRemoveTarget(null)}>取消</button>
            <button type='button' className='preview-button danger-button' disabled={removing} onClick={() => { void confirmRemoveSkill(); }}>{removing ? '正在移出…' : '确认移出'}</button>
          </div>
        </div>
      </div>
    )}
  </div>;
});

export default SkillCategory;
