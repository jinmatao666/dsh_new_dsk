import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Modal, Table, Tag, Tooltip } from '@douyinfe/semi-ui';
import SkillBrowseDrawer from './SkillBrowseDrawer';
import { importSkillFolder } from './skillFolderImport';
import { API, showError, showSuccess } from '../helpers';
import './SkillsTable.css';

const STATUS_LABELS = { 1: '已上架', 0: '已下架' };
const STATUS_COLORS = { 1: 'green', 0: 'grey' };

const splitLines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
const compactTime = value => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', { hour12: false }) : '-';

const EMPTY_FORM = {
  name: '',
  display_name: '',
  category: '办公文档',
  version: '1.0.0',
  status: '0',
  summary: '',
  description: '',
  capabilities: '',
  body: ''
};

const SkillsTable = forwardRef(({ keyword: keywordProp = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [keyword, setKeyword] = useState(keywordProp);
  const [browse, setBrowse] = useState({ visible: false, skill: null });
  // editor.base 为被编辑的技能；null 表示新增
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // 从文件夹导入的产物；null 表示本次编辑未导入
  const [imported, setImported] = useState(null);
  const folderInputRef = useRef(null);
  const loadSkills = useCallback(async () => {
    try {
      const response = await API.get('/api/skill/admin/list', { params: { page: 1, perPage: 100 } });
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
    } catch (error) {
      showError(error.message || '加载技能失败');
    }
  }, []);
  useEffect(() => { void loadSkills(); }, [loadSkills]);

  const onKeywordChange = useCallback(value => setKeyword(value || ''), []);
  useImperativeHandle(ref, () => ({ onKeywordChange, openCreate: () => openEditor(null) }));

  const openEditor = (skill) => {
    setImported(null);
    setForm(skill ? {
      name: skill.name || '',
      display_name: skill.display_name || '',
      category: skill.category || '办公文档',
      version: skill.version || '1.0.0',
      status: String(skill.status ?? 0),
      summary: skill.summary || '',
      description: skill.description || '',
      capabilities: '',
      body: skill.body || ''
    } : { ...EMPTY_FORM });
    setEditor({ base: skill || null });
  };
  const closeEditor = () => setEditor(null);
  const setField = field => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleFolderImport = async (e) => {
    const files = Array.from(e.target.files || []);
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (!files.length) return;
    try {
      const result = await importSkillFolder(files);
      setForm(prev => ({
        ...prev,
        name: prev.name || result.name,
        display_name: prev.display_name || result.displayName,
        description: prev.description || result.description,
        body: result.body
      }));
      setImported({ fileCount: result.fileCount, paths: result.paths, assets: result.assets });
      showSuccess(`已导入 ${result.fileCount} 个文件`);
    } catch (err) {
      showError(err.message || '导入失败');
    }
  };

  const filteredItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return items;
    return items.filter(item => [item.name, item.display_name, item.description, item.category, item.submitter].join(' ').toLowerCase().includes(query));
  }, [items, keyword]);

  const removeSkill = skill => Modal.confirm({ title: `删除技能「${skill.display_name || skill.name}」？`, content: '删除后将不再出现在桌面技能广场。', okType: 'danger', onOk: async () => { await API.delete(`/api/skill/${skill.id}`); await loadSkills(); showSuccess('技能已删除'); } });
  const togglePublish = async skill => {
    const nextStatus = skill.status === 1 ? 0 : 1;
    try {
      await API.put(`/api/skill/${skill.id}`, { status: nextStatus });
      await loadSkills();
      showSuccess(nextStatus === 1 ? '技能已上架，桌面端刷新后可见' : '技能已下架，桌面端刷新后将隐藏');
    } catch (error) { showError(error.message || '更新状态失败'); }
  };

  const columns = [
    {
      title: '技能', width: 190, render: (_, record) => (
        <div className='skill-name'>
          <span className='skill-name-main'>{record.display_name}</span>
          <span className='skill-name-sub'>{record.name} · {record.team || '-'}</span>
        </div>
      )
    },
    { title: '分类', dataIndex: 'category', width: 90, render: value => <Tag color='blue' size='small'>{value}</Tag> },
    {
      title: '主要能力', width: 180, render: (_, record) => {
        const capabilities = Array.isArray(record.tags) ? record.tags : [];
        if (capabilities.length === 0) return null;
        return (
          <Tooltip
            content={(
              <div className='skill-cap-tip'>
                {capabilities.map(item => <div key={item} className='skill-cap-tip-item'>{item}</div>)}
              </div>
            )}
          >
            <div className='skill-cap-row'>
              <span className='skill-cap-tag'>{capabilities[0]}</span>
              {capabilities.length > 1 && <span className='skill-cap-more'>+{capabilities.length - 1}</span>}
            </div>
          </Tooltip>
        );
      }
    },
    { title: '版本', dataIndex: 'version', width: 70, render: value => <span style={{ color: '#607a9e' }}>v{value}</span> },
    { title: '上传人', dataIndex: 'submitter', width: 74 },
    { title: '上传时间', dataIndex: 'created_at', width: 136, render: value => <span style={{ color: '#607a9e' }}>{compactTime(value)}</span> },
    { title: '安装量', dataIndex: 'downloads', width: 66 },
    { title: '状态', width: 76, render: (_, record) => <Tag color={STATUS_COLORS[record.status] || 'grey'} size='small'>{STATUS_LABELS[record.status] || record.status}</Tag> },
    {
      title: '操作', width: 180, render: (_, record) => (
        <div className='skill-row-actions'>
          <button type='button' className='skill-text-action' onClick={() => setBrowse({ visible: true, skill: record })}>浏览</button>
          <button type='button' className='skill-text-action' onClick={() => { void togglePublish(record); }}>{record.status === 1 ? '下架' : '上架'}</button>
          <button type='button' className='skill-text-action' onClick={() => openEditor(record)}>编辑</button>
          <button type='button' className='skill-text-action danger' onClick={() => removeSkill(record)}>删除</button>
        </div>
      )
    }
  ];

  const saveSkill = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const displayName = form.display_name.trim();
    if (!name) { showError('请输入技能标识'); return; }
    if (!displayName) { showError('请输入显示名称'); return; }
    const base = editor.base || {};
    const payload = {
      name,
      display_name: displayName,
      category: form.category,
      description: form.description || form.summary,
      scenario: form.summary,
      tags: splitLines(form.capabilities),
      submitter: base.submitter || 'root',
      version: form.version || '1.0.0',
      status: Number(form.status),
      body: form.body || base.body || '',
      assets: imported?.assets ?? base.assets ?? ''
    };
    if (!editor.base && !payload.body) { showError('请输入 SKILL.md 内容或导入技能文件夹'); return; }
    try {
      if (editor.base) await API.put(`/api/skill/${editor.base.id}`, payload);
      else await API.post('/api/skill/', payload);
      await loadSkills();
      setEditor(null);
      showSuccess(payload.status === 1 ? '保存并上架成功' : '保存成功');
    } catch (error) { showError(error.response?.data?.message || error.message || '保存失败'); }
  };

  return <div className='skill-admin'>
    <div className='preview-stat-grid'>
      <div>
        <span>技能总数</span>
        <strong>{items.length}</strong>
      </div>
      <div>
        <span>已上架</span>
        <strong>{items.filter(item => item.status === 1).length}</strong>
      </div>
      <div>
        <span>当前分类</span>
        <strong>{new Set(items.map(item => item.category)).size}</strong>
      </div>
    </div>
    <section className='preview-surface skill-admin-surface'>
      <div className='preview-section-head'>
        <h2>技能列表</h2>
        <span className='skill-admin-meta'>共 {filteredItems.length} 条{keyword.trim() ? ` · 搜索“${keyword.trim()}”` : ''}</span>
      </div>
      <Table columns={columns} dataSource={filteredItems} rowKey='id' pagination={{ pageSize: 20 }} scroll={{ x: 1062 }} empty='暂无技能' />
    </section>
    <SkillBrowseDrawer visible={browse.visible} kind='public' id={browse.skill?.id} skill={browse.skill} onClose={() => setBrowse({ visible: false, skill: null })} />
    {editor && (
      <div className='zjugis-modal-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) closeEditor(); }}>
        <div className='zjugis-modal wide'>
          <div className='zjugis-modal-head'>
            <h2>{editor.base ? '编辑技能' : '新增技能'}</h2>
            <button type='button' onClick={closeEditor} aria-label='关闭'>×</button>
          </div>
          <form className='zjugis-form' onSubmit={saveSkill}>
            <div className='form-grid'>
              <label className='zjugis-field'>
                <span>技能标识（英文 slug）<i className='skill-required'>*</i></span>
                <input value={form.name} onChange={setField('name')} placeholder='例如 land-evaluation' disabled={Boolean(editor.base)} />
              </label>
              <label className='zjugis-field'>
                <span>显示名称<i className='skill-required'>*</i></span>
                <input value={form.display_name} onChange={setField('display_name')} placeholder='例如 土地评估报告' />
              </label>
              <label className='zjugis-field'>
                <span>分类</span>
                <select value={form.category} onChange={setField('category')}>
                  {[...new Set(['办公文档', '空间制图', '研究咨询', '数据分析', ...items.map(item => item.category).filter(Boolean), '其他'])].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className='zjugis-field'>
                <span>版本</span>
                <input value={form.version} onChange={setField('version')} placeholder='1.0.0' />
              </label>
              <label className='zjugis-field'>
                <span>上架状态</span>
                <select value={form.status} onChange={setField('status')}>
                  <option value='0'>已下架</option>
                  <option value='1'>已上架</option>
                </select>
              </label>
            </div>
            {!editor.base && (
              <label className='zjugis-field full'>
                <span>从文件夹导入技能（可选）</span>
                <div className='form-inline-actions'>
                  <button type='button' className='preview-button' onClick={() => folderInputRef.current?.click()}>
                    选择 SKILL 文件夹
                  </button>
                  {imported && <span className='skill-import-ok'>已导入 {imported.fileCount} 个文件，保存后可在详情中查看</span>}
                </div>
                <small className='preview-muted'>文件夹需包含 SKILL.md；标识、描述与正文将自动填充，其余文件随技能包一起保存。</small>
                <input
                  ref={folderInputRef}
                  type='file'
                  multiple
                  hidden
                  onChange={handleFolderImport}
                  {...{ webkitdirectory: '', directory: '' }}
                />
              </label>
            )}
            <label className='zjugis-field full'>
              <span>一句话简介</span>
              <input value={form.summary} onChange={setField('summary')} placeholder='一句话说明技能用途' />
            </label>
            <label className='zjugis-field full'>
              <span>详细描述</span>
              <textarea rows='3' value={form.description} onChange={setField('description')} placeholder='技能的完整功能说明' />
            </label>
            <label className='zjugis-field full'>
              <span>主要能力（每行一条）</span>
              <textarea rows='3' value={form.capabilities} onChange={setField('capabilities')} />
            </label>
            <label className='zjugis-field full'>
              <span>SKILL.md 内容（留空则按上面的信息生成）</span>
              <textarea rows='5' value={form.body} onChange={setField('body')} />
            </label>
            <div className='zjugis-modal-actions'>
              <button type='button' className='preview-button' onClick={closeEditor}>取消</button>
              <button type='submit' className='preview-button primary'>保存技能</button>
            </div>
          </form>
        </div>
      </div>
    )}
  </div>;
});

SkillsTable.displayName = 'SkillsTable';
export default SkillsTable;
