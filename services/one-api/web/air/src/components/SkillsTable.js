import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Modal, Table, Tag, Tooltip, Tree } from '@douyinfe/semi-ui';
import { Bot, ChartColumn, Compass, FileText, Map, Zap } from 'lucide-react';
import SkillBrowseDrawer from './SkillBrowseDrawer';
import { importSkillFolder, zipSkillFolder } from './skillFolderImport';
import { API, showError, showSuccess } from '../helpers';
import { isLocalSkillLayoutPreview } from '../helpers/local-skill-layout-preview';
import './SkillsTable.css';

const STATUS_LABELS = { 1: '已上架', 0: '已下架' };
const STATUS_COLORS = { 1: 'green', 0: 'grey' };
const SKILL_LAYOUT_PREVIEW = isLocalSkillLayoutPreview();
const PREVIEW_CATEGORIES = [
  { id: 'preview-spatial', name: '空间制图' },
  { id: 'preview-document', name: '办公文档' },
  { id: 'preview-analysis', name: '数据分析' }
];
const PREVIEW_SKILLS = [
  { id: 'preview-1', name: 'market-gis-geology-analysis', display_name: '地质条件分析', category: '空间制图', version: '1.4.5', submitter: 'root', created_at: 1788832746, downloads: 1258, status: 1, tags: ['地质环境与灾害易发性分析'] },
  { id: 'preview-2', name: 'market-gis-third-survey-analysis', display_name: '三调土地利用现状分析', category: '数据分析', version: '2.0.0', submitter: '系统管理员', created_at: 1788919146, downloads: 86, status: 1, tags: ['三调地类面积统计', '用地结构研判'] },
  { id: 'preview-3', name: 'planning-compliance-review', display_name: '国土空间规划符合性审查', category: '空间制图', version: '1.0.12', submitter: '规划平台主管', created_at: 1789005546, downloads: 10032, status: 1, tags: ['规划管控规则核验'] },
  { id: 'preview-4', name: 'meeting-minutes-report', display_name: '会议纪要整理与报告生成', category: '办公文档', version: '0.9.3', submitter: 'root', created_at: 1789091946, downloads: 0, status: 0, draft_release_count: 1, tags: ['会议要点提取', '待办事项整理'] }
];
const DEFAULT_SKILL_ICONS = [
  { value: 'glyph:map', label: '地图', Icon: Map },
  { value: 'glyph:document', label: '文档', Icon: FileText },
  { value: 'glyph:chart', label: '图表', Icon: ChartColumn },
  { value: 'glyph:compass', label: '指南', Icon: Compass },
  { value: 'glyph:bot', label: '智能体', Icon: Bot },
  { value: 'glyph:lightning', label: '效率', Icon: Zap }
];

const splitLines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
const compactTime = value => {
  if (!value) return { display: '-', full: '-' };
  const date = new Date(Number(value) * 1000);
  const pad = number => String(number).padStart(2, '0');
  const display = `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const full = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { display, full };
};
const releaseFileTree = files => {
  const root = { label: '技能包/', key: 'root', children: [] }; const folders = new Map([['', root]]);
  for (const item of files) { const parts = String(item.path || '').split('/').filter(Boolean); const leaf = parts.pop(); let parent = root; let current = ''; for (const part of parts) { current = current ? `${current}/${part}` : part; if (!folders.has(current)) { const folder = { label: `${part}/`, key: `dir:${current}`, children: [] }; folders.set(current, folder); parent.children.push(folder); } parent = folders.get(current); } if (leaf) parent.children.push({ label: leaf, key: `file:${item.path}`, isLeaf: true }); }
  return [root];
};
const SkillIcon = ({ icon, small = false }) => {
  const preset = DEFAULT_SKILL_ICONS.find(item => item.value === icon) || DEFAULT_SKILL_ICONS[4];
  const Icon = preset.Icon;
  return <span className={`skill-identity-icon${small ? ' small' : ''}`} title={preset.label}>
    {String(icon || '').startsWith('data:image/') ? <img src={icon} alt='' /> : <Icon aria-hidden size={small ? 16 : 24} strokeWidth={1.8} />}
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
  category: '',
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
    if (SKILL_LAYOUT_PREVIEW) {
      setItems(PREVIEW_SKILLS);
      setManagedCategories(PREVIEW_CATEGORIES);
      return;
    }
    try {
      const [response, categoryResponse] = await Promise.all([
        API.get('/api/skill/admin/list', { params: { page: 1, perPage: 100 } }),
        API.get('/api/skill-category/', { params: { includeDisabled: 0, type: 'skill_package' } })
      ]);
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
      setManagedCategories(Array.isArray(categoryResponse.data?.data) ? categoryResponse.data.data : []);
    } catch (error) {
      showError(error.message || '加载技能失败');
    }
  }, []);
  useEffect(() => { void loadSkills(); }, [loadSkills]);
  useEffect(() => {
    window.addEventListener('skill-categories-changed', loadSkills);
    return () => window.removeEventListener('skill-categories-changed', loadSkills);
  }, [loadSkills]);

  const onKeywordChange = useCallback(value => setKeyword(value || ''), []);
  useImperativeHandle(ref, () => ({ onKeywordChange, openCreate: () => openEditor(null) }));

  const openEditor = (skill) => {
    setImported(null);
    setForm(skill ? {
      name: skill.name || '',
      display_name: skill.display_name || '',
      icon: skill.icon || 'glyph:bot',
      category: skill.category || '',
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
      showError('文件夹导入需要通过 HTTPS 打开后台；当前可使用 ZIP 文件导入，避免浏览器批量上传确认提示。');
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
      title: '技能', width: 215, render: (_, record) => (
        <div className='skill-name'>
          <div className='skill-name-title'><SkillIcon icon={record.icon} small /><Tooltip content={record.display_name || record.name}><span className='skill-name-main'>{record.display_name}</span></Tooltip></div>
          <Tooltip content={`${record.name || '-'} · ${record.team || '-'}`}><span className='skill-name-sub'>{record.name} · {record.team || '-'}</span></Tooltip>
        </div>
      )
    },
    { title: '分类', dataIndex: 'category', width: 96, render: value => <Tooltip content={value || '-'}><Tag color='blue' size='small'>{value}</Tag></Tooltip> },
    {
      title: '主要能力', width: 160, render: (_, record) => {
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
    { title: '版本', dataIndex: 'version', width: 70, render: (value, record) => <button type='button' className='skill-version-action' title={`v${value || '-'}`} onClick={() => { void openReleases(record); }}>v{value}</button> },
    { title: '上传人', dataIndex: 'submitter', width: 90, render: value => <Tooltip content={value || 'root'}><span className='skill-uploader'>{value || 'root'}</span></Tooltip> },
    { title: '上传时间', dataIndex: 'created_at', width: 118, render: value => { const time = compactTime(value); return <span className='skill-upload-time' title={time.full}>{time.display}</span>; } },
    { title: '安装量', dataIndex: 'downloads', width: 62, render: value => { const downloads = Number(value || 0); return <Tooltip content={`安装量：${downloads}`}><span className='skill-install-count'>{downloads}</span></Tooltip>; } },
    { title: '状态', width: 76, render: (_, record) => record.draft_release_count > 0
      ? <div className='skill-status-stack'><Tag color='orange' size='small'>草稿 {record.draft_release_count}</Tag>{record.status === 1 && <small>当前版本已上架</small>}</div>
      : <Tag color={STATUS_COLORS[record.status] || 'grey'} size='small'>{record.status === 1 ? STATUS_LABELS[record.status] : '未发布'}</Tag> },
    {
      title: '操作', width: 134, render: (_, record) => (
        <div className='skill-row-actions'>
          <button type='button' className='skill-text-action' onClick={() => setBrowse({ visible: true, skill: record })}>浏览</button>
          <button type='button' className='skill-text-action' onClick={() => { void togglePublish(record); }}>{record.status === 1 ? '下架' : '发布'}</button>
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
    if (!form.category) { showError('请选择分类；分类由“分类管理”维护'); return; }
    const base = editor.base || {};
    const payload = {
      name,
      display_name: displayName,
      category: form.category,
      description: form.description || form.summary,
      scenario: form.summary,
      tags: splitLines(form.capabilities),
      icon: form.icon,
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
      <Table columns={columns} dataSource={filteredItems} rowKey='id' tableLayout='fixed' pagination={{ pageSize: 20 }} empty='暂无技能' />
    </section>
    <SkillBrowseDrawer visible={browse.visible} kind='public' id={browse.skill?.id} skill={browse.skill} onClose={() => setBrowse({ visible: false, skill: null })} />
    {importDialogVisible && (
      <div className='zjugis-modal-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) setImportDialogVisible(false); }}>
        <div className='zjugis-modal'>
          <div className='zjugis-modal-head'>
            <h2>导入技能</h2>
            <button type='button' onClick={() => setImportDialogVisible(false)} aria-label='关闭'>×</button>
          </div>
          <div className='skill-import-dialog'>
            <p>选择导入方式。导入后先生成草稿，完成校验后才会发布到桌面端。</p>
            <div className='skill-import-options'>
              <button type='button' className='skill-import-option' onClick={() => { void chooseSkillFolder(); }}>
                <span className='skill-import-option-icon'>
                  <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <path d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' />
                    <path d='M12 10v6' />
                    <path d='m9 13 3 3 3-3' />
                  </svg>
                </span>
                <span className='skill-import-option-copy'><strong>从技能文件夹导入</strong><span>选择包含 SKILL.md 的完整目录，系统自动打包</span></span>
                <span className='skill-import-option-arrow'>
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <path d='M5 12h14' />
                    <path d='m13 6 6 6-6 6' />
                  </svg>
                </span>
              </button>
              <button type='button' className='skill-import-option' onClick={() => zipInputRef.current?.click()}>
                <span className='skill-import-option-icon'>
                  <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <rect x='3' y='4' width='18' height='4' rx='1' />
                    <path d='M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8' />
                    <path d='M10 12h4' />
                  </svg>
                </span>
                <span className='skill-import-option-copy'><strong>从 ZIP 文件导入</strong><span>导入已准备好的完整技能包</span></span>
                <span className='skill-import-option-arrow'>
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <path d='M5 12h14' />
                    <path d='m13 6 6 6-6 6' />
                  </svg>
                </span>
              </button>
            </div>
            <div className='skill-import-footer'><button type='button' className='preview-button' onClick={() => setImportDialogVisible(false)}>取消</button></div>
          </div>
        </div>
      </div>
    )}
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
                  <option value=''>请选择分类</option>
                  {managedCategories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}
                </select>
                <small className='preview-muted'>只能选择“分类管理”中已启用的分类。</small>
              </label>
            </div>
            <label className='zjugis-field full'>
              <span>技能图标</span>
              <div className='skill-icon-picker'>
                <div className='skill-icon-preview'><SkillIcon icon={form.icon} /></div>
                <div className='skill-icon-options'>
                  <span className='skill-icon-picker-label'>选择通用图标</span>
                  <div className='skill-icon-presets'>
                    {DEFAULT_SKILL_ICONS.map(item => <button key={item.value} type='button' className={form.icon === item.value ? 'active' : ''} onClick={() => setForm(prev => ({ ...prev, icon: item.value }))} title={item.label} aria-label={item.label}><item.Icon aria-hidden size={18} strokeWidth={1.8} /></button>)}
                  </div>
                  <div className='form-inline-actions'>
                    <button type='button' className='preview-button' onClick={() => iconInputRef.current?.click()}>上传自定义图标</button>
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
