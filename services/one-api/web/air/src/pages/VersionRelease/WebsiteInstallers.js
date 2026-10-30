import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { Download, FileUp, Globe, Package, RefreshCw } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import { API, showError, showSuccess } from '../../helpers';

const systems = { windows: 'Windows', macos: 'macOS' };
const formats = { windows: '.exe', macos: '.dmg' };
const targets = [
  { system: 'windows', architecture: 'x64', label: 'Windows x64', format: 'EXE 安装程序' },
  { system: 'macos', architecture: 'arm64', label: 'macOS ARM64', format: 'Apple Silicon · DMG' },
  { system: 'macos', architecture: 'x64', label: 'macOS x64', format: 'Intel · DMG' },
];

const endpoint = '/api/admin/website-installers';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** First-install file management; independent of desktop updater bundle publication. */
export default function WebsiteInstallers() {
  const [system, setSystem] = useState('windows');
  const [architecture, setArchitecture] = useState('x64');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState({ items: [], channels: [], max_bytes: 2147483648 });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [action, setAction] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const mounted = useRef(false);
  const pending = useRef(false);
  const input = useRef(null);
  const refresh = async signal => {
    try {
      const { data } = await API.get(endpoint, { signal });
      if (!data.success) throw new Error(data.message || '读取官网安装包失败');
      if (mounted.current && !signal?.aborted) {
        setSnapshot({ items: data.data.items || [], channels: data.data.channels || [], max_bytes: data.data.max_bytes || 2147483648 });
        setLoaded(true); setError('');
      }
    } catch (failure) { if (mounted.current && !signal?.aborted) { setLoaded(false); setError(failure.response?.data?.message || failure.message); } }
  };
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); refresh(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  const records = snapshot.items.filter(item => filter === 'all' || item.platform === filter);
  const pages = Math.max(1, Math.ceil(records.length / 12));
  useEffect(() => setPage(1), [filter]);
  useEffect(() => setPage(current => Math.min(current, pages)), [pages]);
  const upload = async () => {
    if (pending.current || !loaded || !file || !stableVersion.test(version.trim())) return;
    pending.current = true; setBusy(true); setProgress(0); setError('');
    const payload = new FormData(); payload.append('file', file); payload.append('version', version.trim());
    payload.append('platform', `${system}-${architecture}`); payload.append('notes', notes);
    try {
      const { data } = await API.post(endpoint, payload, { onUploadProgress: event => { if (mounted.current && event.total) setProgress(Math.round(event.loaded * 100 / event.total)); } });
      if (!data.success) throw new Error(data.message || '上传安装包失败');
      if (!mounted.current) return;
      setFile(null); setNotes(''); if (input.current) input.current.value = '';
      showSuccess('安装包已保存为待发布，请核对后确认发布'); await refresh();
    } catch (failure) { if (mounted.current) setError(failure.response?.data?.message || failure.message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const commit = async () => {
    if (!action || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const { data } = action.kind === 'delete' ? await API.delete(`${endpoint}/${action.record.id}`) : await API.post(`${endpoint}/${action.record.id}/${action.kind}`);
      if (!data.success) throw new Error(data.message || '操作失败');
      if (!mounted.current) return;
      showSuccess(action.kind === 'publish' ? '已发布到官网安装包目录' : action.kind === 'withdraw' ? '已撤下，不会回退到旧安装包' : data.message || '安装包及记录已删除');
      setAction(null); await refresh();
    } catch (failure) { if (mounted.current) showError(failure.response?.data?.message || failure.message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const changeSystem = next => {
    setSystem(next); setFile(null); setError('');
    if (next === 'windows') setArchitecture('x64');
    if (input.current) input.current.value = '';
  };
  const changeArchitecture = next => {
    setArchitecture(next); setFile(null); setError('');
    if (input.current) input.current.value = '';
  };
  const selectFile = event => {
    const selected = event.target.files?.[0];
    setError(''); setFile(null);
    if (!selected) return;
    if (selected.size === 0 || selected.size > snapshot.max_bytes) { setError(`安装包不能为空，大小不能超过 ${(snapshot.max_bytes / 1048576).toFixed(0)} MB。`); event.target.value = ''; return; }
    if (!formats[system].split(',').some(extension => selected.name.toLowerCase().endsWith(extension.toLowerCase()))) {
      setError(`请选择 ${systems[system]} 安装包（${formats[system]}），不要上传签名更新 ZIP。`);
      event.target.value = ''; return;
    }
    setFile(selected);
  };
  return <section className="website-installers" aria-label="官网安装包">
    <div className="release-section-heading">
      <div><h2>上传官网安装包</h2><p className="settings-description">提供给首次安装的用户。安装包上传后需单独确认发布，再展示到官网对应系统的下载入口。</p></div>
      <span className="release-key-status is-ready"><Globe size={16} />官网下载安装</span>
    </div>
    <div className="installer-preview-note" role="note"><span>独立发布</span>官网安装包用于首次安装，与客户端更新包分别管理。macOS 的芯片架构和版本号请与实际构建产物核对。</div>
    {error && <p role="alert" className="release-error">{error}</p>}
    <fieldset className="installer-form-fields" disabled={busy || !loaded}>
    <div className="installer-targets" role="group" aria-label="选择官网安装包平台">
      {targets.map(target => <button key={`${target.system}-${target.architecture}`} type="button" aria-pressed={system === target.system && architecture === target.architecture} onClick={() => { changeSystem(target.system); changeArchitecture(target.architecture); }}><Package size={20} strokeWidth={1.5} /><span><strong>{target.label}</strong><small>{target.format}</small></span><span className="installer-target-dot" aria-hidden="true" /></button>)}
    </div>
    <div className="release-upload">
      <div className="release-metadata">
        <label>版本号<input aria-label="官网安装包版本号" placeholder="例如 1.0.2" value={version} onChange={event => setVersion(event.target.value)} /><small>与安装包实际版本一致，格式为 x.y.z。</small></label>
        <label>操作系统<span className="release-select"><CustomSelect aria-label="官网安装包操作系统" value={system} onChange={event => changeSystem(event.target.value)}>{Object.entries(systems).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</CustomSelect></span></label>
        <label>架构<span className="release-select"><CustomSelect aria-label="官网安装包架构" value={architecture} onChange={event => changeArchitecture(event.target.value)}><option value="x64">x64{system === 'macos' ? '（Intel）' : ''}</option>{system === 'macos' && <option value="arm64">ARM64（Apple Silicon）</option>}</CustomSelect></span><small>不同系统、架构分别管理官网的下载版本。</small></label>
      </div>
      <div className="release-upload-field"><span>安装包</span><label className="release-file"><input ref={input} type="file" aria-label="官网安装包文件" accept={formats[system]} onChange={selectFile} /><FileUp size={24} strokeWidth={1.5} /><span><strong>{file ? file.name : '选择客户端安装包'}</strong><small>{file ? `${(file.size / 1048576).toFixed(1)} MB · 点击重新选择` : `支持 ${formats[system]}，请上传可直接安装的文件，不要上传更新 ZIP`}</small></span></label>{error && <p className="release-error" role="alert">{error}</p>}</div>
      <div className="release-upload-notes"><label htmlFor="website-installer-notes">版本说明</label><textarea id="website-installer-notes" placeholder="填写本次版本亮点、优化内容或安装说明，发布后在官网展示" value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={16000} /></div>
      <div className="release-upload-actions"><button type="button" className="settings-primary" disabled={busy || !loaded || !file || !stableVersion.test(version.trim())} onClick={upload}>上传并保存</button><span role={busy ? 'status' : undefined}>{busy ? action ? '正在处理发布状态…' : progress < 100 ? `上传中 ${progress}%` : '正在校验安装包，请勿重复上传' : '保存为待发布安装包；发布后才会提供官网下载，不影响客户端自动更新。'}</span></div>
    </div>
    </fieldset>
    <div className="release-list-heading"><div><h2>官网发布记录</h2><span>共 {records.length} 个安装包</span></div><div className="release-list-actions"><span className="release-select"><CustomSelect aria-label="筛选官网安装包平台" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部平台</option>{targets.map(target => <option key={`${target.system}-${target.architecture}`} value={`${target.system}-${target.architecture}`}>{target.label}</option>)}</CustomSelect></span><button type="button" className="settings-secondary release-refresh" disabled={busy} onClick={() => refresh()}><RefreshCw size={15} />刷新列表</button></div></div>
    <div className="preview-table-wrap release-table-scroll"><table className="preview-table release-table installer-records"><thead><tr>{['版本', '系统', '架构', '安装包', '版本说明', '状态', '操作'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
      {records.slice((page - 1) * 12, page * 12).map(record => {
        const channel = snapshot.channels.find(item => item.platform === record.platform && item.release_id === record.id);
        const published = Boolean(channel?.published);
        const [os, arch] = record.platform.split('-');
        return <tr key={record.id}><td><strong>{record.version}</strong></td><td>{systems[os]}</td><td>{arch === 'arm64' ? 'ARM64' : 'x64'}</td><td title={`${record.filename}\nSHA-256: ${record.sha256}`}>{(record.size / 1048576).toFixed(1)} MB</td><td><div className="release-notes-cell"><span>{record.notes || '未填写版本说明'}</span><button type="button" className="link-button" onClick={() => setDetail(record)}>详情</button></div></td><td><span className={`release-status${published ? ' is-published' : ''}`}>{channel ? published ? '已发布' : '已撤下' : '待发布'}</span></td><td><button type="button" className="link-button" disabled={busy} onClick={() => setAction({ record, kind: published ? 'withdraw' : 'publish' })}>{published ? '撤下' : '发布'}</button><button type="button" className="link-button release-delete" disabled={busy || published} title={published ? '请先撤下再删除' : '删除安装包及记录'} onClick={() => setAction({ record, kind: 'delete' })}>删除</button>{published && <a className="link-button installer-download" href={`${API.defaults?.baseURL || ''}/downloads/installers/${record.id}`} target="_blank" rel="noopener noreferrer"><Download size={13} />下载</a>}</td></tr>;
      })}
      {records.length === 0 && <tr><td colSpan={7} className="release-empty"><div className="installer-empty"><Package size={30} strokeWidth={1.3} /><strong>{loaded ? '暂无官网安装包' : '尚未读取到安装包列表'}</strong><span>{loaded ? '上传安装包后，在这里确认发布或管理历史版本。' : '请检查网络和管理员权限，再刷新列表。'}</span></div></td></tr>}
    </tbody></table></div>
    <div className="zjugis-table-pagination"><span>共 {records.length} 条记录</span><div><button type="button" aria-label="官网安装包上一页" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {pages}</span><button type="button" aria-label="官网安装包下一页" disabled={page === pages} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>
    <Modal className="release-dialog" centered width={640} style={{ maxWidth: 'calc(100vw - 32px)' }} visible={Boolean(detail)} title="安装包详情" footer={null} onCancel={() => setDetail(null)}><div className="release-full-notes installer-detail"><strong>{detail?.filename}</strong><p>SHA-256：{detail?.sha256}</p><p>{detail?.notes || '未填写版本说明'}</p></div></Modal>
    <Modal className="release-dialog" centered width={560} style={{ maxWidth: 'calc(100vw - 32px)' }} visible={Boolean(action)} title={action?.kind === 'publish' ? '确认发布官网安装包' : action?.kind === 'withdraw' ? '确认撤下官网安装包' : '确认删除官网安装包'} confirmLoading={busy} onOk={commit} onCancel={() => { if (!busy) setAction(null); }} okText="确认" cancelText="取消" okButtonProps={{ 'aria-label': '确认', type: action?.kind === 'delete' ? 'danger' : 'primary' }} cancelButtonProps={{ 'aria-label': '取消' }}>{action && <p>{targets.find(target => `${target.system}-${target.architecture}` === action.record.platform)?.label} · {action.record.version}：{action.kind === 'publish' ? '将设为该平台的当前官网安装包，替换原下载版本。请确认已完成安装测试。' : action.kind === 'withdraw' ? '撤下后停止提供此文件下载，不会自动回退到历史安装包。' : '将永久删除安装包文件及记录，无法恢复。确认删除？'}</p>}</Modal>
  </section>;
}
