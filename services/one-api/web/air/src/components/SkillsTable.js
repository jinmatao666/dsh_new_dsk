import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Modal, Table, Tag, Tooltip, Tree } from '@douyinfe/semi-ui';
import SkillBrowseDrawer from './SkillBrowseDrawer';
import { importSkillFolder, zipSkillFolder } from './skillFolderImport';
import { API, showError, showSuccess } from '../helpers';
import './SkillsTable.css';

const STATUS_LABELS = { 1: '已上架', 0: '已下架' };
const STATUS_COLORS = { 1: 'green', 0: 'grey' };
const DEFAULT_SKILL_ICONS = [
  { value: 'glyph:map', label: '地图', glyph: '⌖' },
  { value: 'glyph:document', label: '文档', glyph: '▤' },
  { value: 'glyph:chart', label: '图表', glyph: '◫' },
  { value: 'glyph:compass', label: '指南', glyph: '◉' },
  { value: 'glyph:bot', label: '智能体', glyph: '✦' },
  { value: 'glyph:lightning', label: '效率', glyph: 'ϟ' }
];

const splitLines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
const compactTime = value => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', { hour12: false }) : '-';
const releaseFileTree = files => {
  const root = { label: '技能包/', key: 'root', children: [] }; const folders = new Map([['', root]]);
  for (const item of files) { const parts = String(item.path || '').split('/').filter(Boolean); const leaf = parts.pop(); let parent = root; let current = ''; for (const part of parts) { current = current ? `${current}/${part}` : part; if (!folders.has(current)) { const folder = { label: `${part}/`, key: `dir:${current}`, children: [] }; folders.set(current, folder); parent.children.push(folder); } parent = folders.get(current); } if (leaf) parent.children.push({ label: leaf, key: `file:${item.path}`, isLeaf: true }); }
  return [root];
};
const SkillIcon = ({ icon, small = false }) => {
  const preset = DEFAULT_SKILL_ICONS.find(item => item.value === icon) || DEFAULT_SKILL_ICONS[4];
  return <span className={`skill-identity-icon${small ? ' small' : ''}`} title={preset.label}>
    {String(icon || '').startsWith('data:image/') ? <img src={icon} alt='' /> : preset.glyph}
  </span>;
};
const previewableFile = path => /\.(?:md|txt|json|ya?ml|toml|js|jsx|ts|tsx|py|go|rs|sh|ps1|bat|cmd|css|html?|xml|sql|csv|tsv)$/i.test(path || '');
const decodePackageText = encoded => {
  try {
    const binary = atob(encoded || '');
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '无法读取该文件内容。';
  }
};
const filesFromDirectoryHandle = async (directory, root = directory.name, prefix = '') => {
  const files = [];
  for await (const [name, entry] of directory.entries()) {
    const relativePath = `${prefix}${name}`;
    if (entry.kind === 'directory') {
      files.push(...await filesFromDirectoryHandle(entry, root, `${relativePath}/`));
      continue;
    }
    const file = await entry.getFile();
    // zipSkillFolder consumes webkitRelativePath. Defining it here gives the
    // modern directory picker the same normalized input as webkitdirectory.
    Object.defineProperty(file, 'webkitRelativePath', { value: `${root}/${relativePath}` });
    files.push(file);
  }
  return files;
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
  body: '',
  icon: 'glyph:bot'
};

const SkillsTable = forwardRef(({ keyword: keywordProp = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [managedCategories, setManagedCategories] = useState([]);
  const [keyword, setKeyword] = useState(keywordProp);
  const [browse, setBrowse] = useState({ visible: false, skill: null });
  // editor.base 为被编辑的技能；null 表示新增
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // 从文件夹导入的产物；null 表示本次编辑未导入
  const [imported, setImported] = useState(null);
  const [importDialogVisible, setImportDialogVisible] = useState(false);
  const folderInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const importFolderInputRef = useRef(null);
  const iconInputRef = useRef(null);
  const [releases, setReleases] = useState({ skill: null, items: [], files: [], selectedFilePath: '' });
  const loadSkills = useCallback(async () => {
    try {
      const [response, categoryResponse] = await Promise.all([
        API.get('/api/skill/admin/list', { params: { page: 1, perPage: 100 } }),
        API.get('/api/skill-category/', { params: { includeDisabled: 0 } })
      ]);
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
      setManagedCategories((Array.isArray(categoryResponse.data?.data) ? categoryResponse.data.data : [])
        .filter(category => category.type_code === 'skill_package'));
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
      icon: skill.icon || 'glyph:bot',
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

  const chooseIconFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { showError('图标仅支持 PNG、JPEG、WebP 格式'); return; }
    if (file.size > 400 * 1024) { showError('图标文件不能超过 400 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => setForm(prev => ({ ...prev, icon: String(reader.result || '') }));
    reader.onerror = () => showError('读取图标失败');
    reader.readAsDataURL(file);
  };

  const importZip = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportDialogVisible(false);
    const data = new FormData(); data.append('package', file); data.append('changelog', '后台导入');
    try {
      const response = await API.post('/api/skill/admin/import', data);
      const result = response.data?.data;
      await loadSkills();
      showSuccess(`已创建 ${result?.release?.version || ''} 草稿，请在版本列表校验并发布`);
      if (result?.skill?.id) await openReleases(result.skill);
    } catch (error) { showError(error.response?.data?.message || error.message || '导入技能包失败'); }
  };
  const importFolderFiles = async (files) => {
    if (!files.length) return;
    setImportDialogVisible(false);
    try {
      const zip = await zipSkillFolder(files);
      await importZip({ target: { files: [new File([zip], `${files[0].webkitRelativePath.split('/')[0]}.zip`, { type: 'application/zip' })], value: '' } });
    } catch (error) { showError(error.message || '导入技能文件夹失败'); }
  };
  const importFolder = async (event) => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    await importFolderFiles(files);
  };
  const chooseSkillFolder = async () => {
    if (typeof window.showDirectoryPicker !== 'function') {
      importFolderInputRef.current?.click();
      return;
    }
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read' });
      await importFolderFiles(await filesFromDirectoryHandle(directory));
    } catch (error) {
      if (error?.name !== 'AbortError') showError(error.message || '读取技能文件夹失败');
    }
  };
  const openReleases = async skill => {
    try { const response = await API.get(`/api/skill/${skill.id}/releases`); setReleases({ skill, items: response.data?.data || [], files: [], selectedFilePath: '' }); }
    catch (error) { showError(error.response?.data?.message || error.message || '加载版本失败'); }
  };
  const releaseAction = async (release, action) => {
    const skill = releases.skill; if (!skill) return;
    try {
      const response = await API.post(`/api/skill/${skill.id}/releases/${release.id}/${action}`);
      await loadSkills(); await openReleases(skill);
      if (action === 'validate') {
        const files = response.data?.data?.files || [];
        setReleases(current => ({ ...current, files, selectedFilePath: files.find(file => file.path === 'SKILL.md')?.path || files[0]?.path || '' }));
      }
      showSuccess(action === 'validate' ? '版本校验通过，请核对完整文件后发布' : action === 'publish' ? '版本已发布' : '已回滚到该版本');
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
    if (skill.status !== 1) { await openReleases(skill); return; }
    try {
      await API.post(`/api/skill/${skill.id}/unpublish`);
      await loadSkills();
      showSuccess('技能已下架，桌面端刷新后将隐藏');
    } catch (error) { showError(error.message || '更新状态失败'); }
  };

  const columns = [
    {
      title: '技能', width: 210, render: (_, record) => (
        <div className='skill-name'>
          <div className='skill-name-title'><SkillIcon icon={record.icon} small /><span className='skill-name-main'>{record.display_name}</span></div>
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
    { title: '状态', width: 100, render: (_, record) => record.draft_release_count > 0
      ? <div className='skill-status-stack'><Tag color='orange' size='small'>草稿 {record.draft_release_count}</Tag>{record.status === 1 && <small>当前版本已上架</small>}</div>
      : <Tag color={STATUS_COLORS[record.status] || 'grey'} size='small'>{record.status === 1 ? STATUS_LABELS[record.status] : '未发布'}</Tag> },
    {
      title: '操作', width: 180, render: (_, record) => (
        <div className='skill-row-actions'>
          <button type='button' className='skill-text-action' onClick={() => setBrowse({ visible: true, skill: record })}>浏览</button>
          <button type='button' className='skill-text-action' onClick={() => { void togglePublish(record); }}>{record.status === 1 ? '下架' : '去发布'}</button>
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
      icon: form.icon,
      submitter: base.submitter || 'root',
    };
    if (!editor.base) { showError('请先通过“导入技能”创建技能草稿'); return; }
    try {
      if (editor.base) await API.put(`/api/skill/${editor.base.id}`, payload);
      else await API.post('/api/skill/', payload);
      await loadSkills();
      setEditor(null);
      showSuccess('技能元数据已保存');
    } catch (error) { showError(error.response?.data?.message || error.message || '保存失败'); }
  };

  const selectedReleaseFile = releases.files.find(file => file.path === releases.selectedFilePath);

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
        <div className='form-inline-actions'><span className='skill-admin-meta'>共 {filteredItems.length} 条{keyword.trim() ? ` · 搜索“${keyword.trim()}”` : ''}</span><button type='button' className='preview-button primary' onClick={() => setImportDialogVisible(true)}>导入技能</button></div>
      </div>
      <input ref={zipInputRef} hidden type='file' accept='.zip,application/zip' onChange={importZip} />
      <input ref={importFolderInputRef} hidden type='file' multiple onChange={importFolder} {...{ webkitdirectory: '', directory: '' }} />
      <Table columns={columns} dataSource={filteredItems} rowKey='id' pagination={{ pageSize: 20 }} scroll={{ x: 1062 }} empty='暂无技能' />
    </section>
    <SkillBrowseDrawer visible={browse.visible} kind='public' id={browse.skill?.id} skill={browse.skill} onClose={() => setBrowse({ visible: false, skill: null })} />
    <Modal
      visible={importDialogVisible}
      title='导入技能'
      onCancel={() => setImportDialogVisible(false)}
      footer={null}
    >
      <div className='skill-import-dialog'>
        <p>选择导入方式。导入后先生成草稿，完成校验后才会发布到桌面端。</p>
        <div className='skill-import-options'>
          <button type='button' className='skill-import-option' onClick={() => { void chooseSkillFolder(); }}>
            <span className='skill-import-option-icon'>▣</span>
            <span className='skill-import-option-copy'><strong>从技能文件夹导入</strong><span>选择包含 SKILL.md 的完整目录，系统自动打包</span></span>
            <span className='skill-import-option-arrow'>→</span>
          </button>
          <button type='button' className='skill-import-option' onClick={() => zipInputRef.current?.click()}>
            <span className='skill-import-option-icon'>⌁</span>
            <span className='skill-import-option-copy'><strong>从 ZIP 文件导入</strong><span>导入已准备好的完整技能包</span></span>
            <span className='skill-import-option-arrow'>→</span>
          </button>
        </div>
        <div className='skill-import-footer'><button type='button' className='preview-button' onClick={() => setImportDialogVisible(false)}>取消</button></div>
      </div>
    </Modal>
    <Modal visible={Boolean(releases.skill)} title={`版本管理${releases.skill ? `：${releases.skill.display_name || releases.skill.name}` : ''}`} onCancel={() => setReleases({ skill: null, items: [], files: [], selectedFilePath: '' })} footer={null}>
      <Table rowKey='id' dataSource={releases.items} pagination={false} columns={[
        { title: '版本', dataIndex: 'version' }, { title: '状态', render: (_, release) => <Tag color={release.state === 'published' ? 'green' : release.state === 'draft' ? (release.validated_at ? 'blue' : 'orange') : 'grey'}>{release.state === 'published' ? '已发布' : release.state === 'draft' ? (release.validated_at ? '已校验' : '草稿') : '已归档'}</Tag> },
        { title: '摘要', dataIndex: 'sha256', render: value => <span title={value}>{String(value || '').slice(0, 12)}</span> }, { title: '文件', dataIndex: 'file_count' },
        { title: '操作', render: (_, release) => <div className='skill-row-actions'><button type='button' className='skill-text-action' onClick={() => { void releaseAction(release, 'validate'); }}>{release.validated_at ? '重新校验' : '校验'}</button>{release.state === 'draft' && release.validated_at && <button type='button' className='skill-text-action' onClick={() => { void releaseAction(release, 'publish'); }}>发布</button>}{release.state === 'archived' && <button type='button' className='skill-text-action' onClick={() => { void releaseAction(release, 'rollback'); }}>回滚</button>}</div> }
      ]} />
      {releases.files.length > 0 && <div className='skill-validation-result'>
        <strong>服务端校验后的完整技能包</strong>
        <p>已校验 {releases.files.length} 个文件。展开结构并查看内容后，再发布到桌面端。</p>
        <div className='skill-validation-content'>
          <div className='skill-validation-tree'><Tree treeData={releaseFileTree(releases.files)} defaultExpandAll /></div>
          <div className='skill-validation-preview'>
            <select value={releases.selectedFilePath} onChange={event => setReleases(current => ({ ...current, selectedFilePath: event.target.value }))}>
              {releases.files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}
            </select>
            {selectedReleaseFile && (previewableFile(selectedReleaseFile.path)
              ? <pre>{decodePackageText(selectedReleaseFile.contentBase64)}</pre>
              : <div className='skill-binary-file'>二进制文件：{selectedReleaseFile.path}<br />已纳入校验包，不提供文本预览。</div>)}
          </div>
        </div>
      </div>}
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
                  {[...new Set([...managedCategories.map(category => category.name), form.category].filter(Boolean))].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <small className='preview-muted'>类别与“分类管理 → 技能包”保持同步。</small>
              </label>
            </div>
            <label className='zjugis-field full'>
              <span>技能标识图片</span>
              <div className='skill-icon-picker'>
                <div className='skill-icon-preview'><SkillIcon icon={form.icon} /></div>
                <div className='skill-icon-options'>
                  <div className='skill-icon-presets'>
                    {DEFAULT_SKILL_ICONS.map(item => <button key={item.value} type='button' className={form.icon === item.value ? 'active' : ''} onClick={() => setForm(prev => ({ ...prev, icon: item.value }))} title={item.label}>{item.glyph}</button>)}
                  </div>
                  <div className='form-inline-actions'>
                    <button type='button' className='preview-button' onClick={() => iconInputRef.current?.click()}>上传图片</button>
                    {String(form.icon || '').startsWith('data:image/') && <button type='button' className='skill-text-action' onClick={() => setForm(prev => ({ ...prev, icon: 'glyph:bot' }))}>恢复默认</button>}
                  </div>
                  <small className='preview-muted'>可选默认图标，或上传 PNG、JPEG、WebP（不超过 400 KB）；保存后桌面端技能广场会同步展示。</small>
                </div>
              </div>
              <input ref={iconInputRef} hidden type='file' accept='image/png,image/jpeg,image/webp' onChange={chooseIconFile} />
            </label>
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
