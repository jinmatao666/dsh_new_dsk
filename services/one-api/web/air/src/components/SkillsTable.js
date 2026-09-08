import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Modal, Table, Tag, Tooltip, Tree } from '@douyinfe/semi-ui';
import SkillBrowseDrawer from './SkillBrowseDrawer';
import { importSkillFolder, zipSkillFolder } from './skillFolderImport';
import { API, showError, showSuccess } from '../helpers';
import './SkillsTable.css';

const STATUS_LABELS = { 1: '已上架', 0: '已下架' };
const STATUS_COLORS = { 1: 'green', 0: 'grey' };

const splitLines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
const compactTime = value => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', { hour12: false }) : '-';
const releaseFileTree = files => {
  const root = { label: '技能包/', key: 'root', children: [] }; const folders = new Map([['', root]]);
  for (const item of files) { const parts = String(item.path || '').split('/').filter(Boolean); const leaf = parts.pop(); let parent = root; let current = ''; for (const part of parts) { current = current ? `${current}/${part}` : part; if (!folders.has(current)) { const folder = { label: `${part}/`, key: `dir:${current}`, children: [] }; folders.set(current, folder); parent.children.push(folder); } parent = folders.get(current); } if (leaf) parent.children.push({ label: leaf, key: `file:${item.path}`, isLeaf: true }); }
  return [root];
};

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
  const zipInputRef = useRef(null);
  const importFolderInputRef = useRef(null);
  const [releases, setReleases] = useState({ skill: null, items: [], files: [] });
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

  const importZip = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const data = new FormData(); data.append('package', file); data.append('changelog', '后台导入');
    try {
      const response = await API.post('/api/skill/admin/import', data);
      const result = response.data?.data;
      await loadSkills();
      showSuccess(`已创建 ${result?.release?.version || ''} 草稿，请在版本列表校验并发布`);
      if (result?.skill?.id) await openReleases(result.skill);
    } catch (error) { showError(error.response?.data?.message || error.message || '导入技能包失败'); }
  };
  const importFolder = async (event) => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length) return;
    try {
      const zip = await zipSkillFolder(files);
      await importZip({ target: { files: [new File([zip], `${files[0].webkitRelativePath.split('/')[0]}.zip`, { type: 'application/zip' })], value: '' } });
    } catch (error) { showError(error.message || '导入技能文件夹失败'); }
  };
  const openReleases = async skill => {
    try { const response = await API.get(`/api/skill/${skill.id}/releases`); setReleases({ skill, items: response.data?.data || [], files: [] }); }
    catch (error) { showError(error.response?.data?.message || error.message || '加载版本失败'); }
  };
  const releaseAction = async (release, action) => {
    const skill = releases.skill; if (!skill) return;
    try {
      const response = await API.post(`/api/skill/${skill.id}/releases/${release.id}/${action}`);
      await loadSkills(); await openReleases(skill);
      if (action === 'validate') setReleases(current => ({ ...current, files: response.data?.data?.files || [] }));
      showSuccess(action === 'validate' ? '版本校验通过' : action === 'publish' ? '版本已发布' : '已回滚到该版本');
    } catch (error) { showError(error.response?.data?.message || error.message || '版本操作失败'); }
  };

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
    if (skill.status !== 1) { showError('请在版本列表中选择一个已校验草稿发布'); return; }
    try {
      await API.post(`/api/skill/${skill.id}/unpublish`);
      await loadSkills();
      showSuccess('技能已下架，桌面端刷新后将隐藏');
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
          <button type='button' className='skill-text-action' onClick={() => { void togglePublish(record); }}>{record.status === 1 ? '下架' : '版本发布'}</button>
          <button type='button' className='skill-text-action' onClick={() => { void openReleases(record); }}>版本</button>
          <button type='button' className='skill-text-action' onClick={() => openEditor(record)}>编辑元数据</button>
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
      version: base.version,
    };
    if (!editor.base) { showError('请使用“导入技能 ZIP”或“导入技能文件夹”创建技能草稿'); return; }
    try {
      if (editor.base) await API.put(`/api/skill/${editor.base.id}`, payload);
      else await API.post('/api/skill/', payload);
      await loadSkills();
      setEditor(null);
      showSuccess('技能元数据已保存');
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
        <div className='form-inline-actions'><span className='skill-admin-meta'>共 {filteredItems.length} 条{keyword.trim() ? ` · 搜索“${keyword.trim()}”` : ''}</span><button type='button' className='preview-button' onClick={() => importFolderInputRef.current?.click()}>导入技能文件夹</button><button type='button' className='preview-button primary' onClick={() => zipInputRef.current?.click()}>导入技能 ZIP</button></div>
      </div>
      <input ref={zipInputRef} hidden type='file' accept='.zip,application/zip' onChange={importZip} />
      <input ref={importFolderInputRef} hidden type='file' multiple onChange={importFolder} {...{ webkitdirectory: '', directory: '' }} />
      <Table columns={columns} dataSource={filteredItems} rowKey='id' pagination={{ pageSize: 20 }} scroll={{ x: 1062 }} empty='暂无技能' />
    </section>
    <SkillBrowseDrawer visible={browse.visible} kind='public' id={browse.skill?.id} skill={browse.skill} onClose={() => setBrowse({ visible: false, skill: null })} />
    <Modal visible={Boolean(releases.skill)} title={`版本管理${releases.skill ? `：${releases.skill.display_name || releases.skill.name}` : ''}`} onCancel={() => setReleases({ skill: null, items: [], files: [] })} footer={null}>
      <Table rowKey='id' dataSource={releases.items} pagination={false} columns={[
        { title: '版本', dataIndex: 'version' }, { title: '状态', dataIndex: 'state', render: value => <Tag color={value === 'published' ? 'green' : value === 'draft' ? 'orange' : 'grey'}>{value === 'published' ? '已发布' : value === 'draft' ? '草稿' : '已归档'}</Tag> },
        { title: '摘要', dataIndex: 'sha256', render: value => <span title={value}>{String(value || '').slice(0, 12)}</span> }, { title: '文件', dataIndex: 'file_count' },
        { title: '操作', render: (_, release) => <div className='skill-row-actions'><button type='button' className='skill-text-action' onClick={() => { void releaseAction(release, 'validate'); }}>校验</button>{release.state !== 'published' && <button type='button' className='skill-text-action' onClick={() => { void releaseAction(release, release.state === 'draft' ? 'publish' : 'rollback'); }}>{release.state === 'draft' ? '发布' : '回滚'}</button>}</div> }
      ]} />
      {releases.files.length > 0 && <div style={{ marginTop: 16 }}><strong>服务端校验后的文件树</strong><Tree treeData={releaseFileTree(releases.files)} defaultExpandAll /></div>}
    </Modal>
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
