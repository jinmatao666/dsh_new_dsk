import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../helpers';
import { FileArchive, ShieldCheck, RefreshCw } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';

const labels = { 'windows-x86_64': 'Windows x64', 'darwin-x86_64': 'macOS Intel', 'darwin-aarch64': 'macOS Apple Silicon', 'linux-x86_64': 'Linux x64', 'linux-aarch64': 'Linux ARM64' };
const systems = { windows: 'Windows', darwin: 'macOS', linux: 'Linux' };
const architectures = { x86_64: 'x64', aarch64: 'ARM64' };
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// This page accepts Runner-produced signed bundles, never a private key or arbitrary download URL.
export default function DesktopUpdates() {
  const [snapshot, setSnapshot] = useState({ items: [], channels: [], signing_configured: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [version, setVersion] = useState('');
  const [uploadSystem, setUploadSystem] = useState('windows');
  const [uploadArchitecture, setUploadArchitecture] = useState('x86_64');
  const [systemFilter, setSystemFilter] = useState('all');
  const [architectureFilter, setArchitectureFilter] = useState('all');
  const [progress, setProgress] = useState(0);
  const [action, setAction] = useState(null);
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(1);
  const mounted = useRef(false);
  const uploadInput = useRef(null);
  const refresh = async (signal) => {
    try {
      const { data } = await API.get('/api/desktop-updates', { signal });
      if (!data.success) throw new Error(data.message);
      if (mounted.current) { setSnapshot(data.data); setFailure(''); }
    } catch (error) { if (mounted.current && !signal?.aborted) setFailure(error.message); }
  };
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    refresh(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  useEffect(() => { setPage(1); }, [systemFilter, architectureFilter]);
  const records = snapshot.items.filter(record => (systemFilter === 'all' || record.platform.startsWith(`${systemFilter}-`)) && (architectureFilter === 'all' || record.platform.endsWith(`-${architectureFilter}`)));
  const pageCount = Math.max(1, Math.ceil(records.length / 12));
  useEffect(() => { setPage(value => Math.min(value, pageCount)); }, [pageCount]);
  const upload = async () => {
    if (!file || busy || !stableVersion.test(version.trim())) return;
    setBusy(true); setProgress(0); setFailure('');
    try {
      const payload = new FormData(); payload.append('file', file); payload.append('notes', notes);
      payload.append('version', version.trim()); payload.append('platform', `${uploadSystem}-${uploadArchitecture}`);
      const { data } = await API.post('/api/desktop-updates', payload, {
        onUploadProgress: event => { if (mounted.current && event.total) setProgress(Math.round(event.loaded * 100 / event.total)); },
      });
      if (!data.success) throw new Error(data.message);
      if (!mounted.current) return;
      setFile(null); setNotes(''); if (uploadInput.current) uploadInput.current.value = '';
      showSuccess('更新包校验通过，已保存为待发布'); await refresh();
    } catch (error) { if (mounted.current) setFailure(error.response?.data?.message || error.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const commit = async () => {
    if (!action || busy) return;
    setBusy(true);
    try {
      const { data } = action.kind === 'delete'
        ? await API.delete(`/api/desktop-updates/${action.record.id}`)
        : await API.post(`/api/desktop-updates/${action.record.id}/${action.kind}${action.confirmOlder ? `?confirm_older=${encodeURIComponent(action.record.version)}` : ''}`);
      if (!data.success) throw new Error(data.message);
      if (!mounted.current) return;
      showSuccess(action.kind === 'delete' ? data.message || '更新包及发布记录已删除' : action.kind === 'publish' ? '已发布，客户端将在检查更新时发现新版' : '已撤下，不会自动回退到旧版本');
      setAction(null); await refresh();
    } catch (error) {
      if (!mounted.current) return;
      if (action.kind === 'publish' && error.response?.data?.confirmation_required === true) {
        setAction({ ...action, confirmOlder: true, previousVersion: error.response.data.previous_version });
      } else showError(error.response?.data?.message || error.message);
    }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section aria-label="桌面端更新包" className="desktop-releases">
    <div className="release-section-heading"><div><h2>上传更新包</h2><p className="settings-description">下载 wanwei-update 产物，解压外层 ZIP，选择里面的发布 ZIP 上传；校验通过后再确认发布。</p></div><span className={`release-key-status${snapshot.signing_configured ? ' is-ready' : ''}`}><ShieldCheck size={16} />{snapshot.signing_configured ? '签名验证已启用' : '待配置公钥'}</span></div>
    {!snapshot.signing_configured && <p role="status">尚未配置更新公钥。请先由运维配置公钥，上传和发布保持关闭；不要在此上传私钥。</p>}
    {failure && <p role="alert" className="release-error">{failure}</p>}
    <div className="release-upload">
      <div className="release-metadata">
        <label>版本号<input aria-label="版本号" placeholder="例如 0.0.5" value={version} onChange={event => setVersion(event.target.value)} disabled={busy} aria-describedby="release-version-hint" /><small id="release-version-hint">必须与构建时的版本号一致，格式为 x.y.z。</small></label>
        <label>操作系统<span className="release-select"><CustomSelect aria-label="操作系统" value={uploadSystem} disabled={busy} onChange={event => { setUploadSystem(event.target.value); if (event.target.value === 'windows') setUploadArchitecture('x86_64'); }}>{Object.entries(systems).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</CustomSelect></span></label>
        <label>架构<span className="release-select"><CustomSelect aria-label="架构" value={uploadArchitecture} disabled={busy} onChange={event => setUploadArchitecture(event.target.value)}><option value="x86_64">x64</option><option value="aarch64" disabled={uploadSystem === 'windows'}>ARM64{uploadSystem === 'windows' ? '（暂未提供构建）' : ''}</option></CustomSelect></span><small>各架构独立发布，不会相互覆盖。</small></label>
      </div>
      <div className="release-upload-field"><span>更新包</span><label className={`release-file${!snapshot.signing_configured ? ' is-disabled' : ''}`}><input ref={uploadInput} type="file" aria-label="单平台发布 ZIP" accept=".zip" disabled={busy || !snapshot.signing_configured} onChange={event => setFile(event.target.files?.[0] || null)} /><FileArchive size={22} strokeWidth={1.5} /><span><strong>{file ? file.name : '选择签名更新包'}</strong><small>{file ? `${(file.size / 1048576).toFixed(1)} MB，点击重新选择` : '选择 wanwei-update 产物内的发布 ZIP，不要上传 wanwei-buddy 普通安装包'}</small></span></label></div>
      <div className="release-upload-notes"><label htmlFor="desktop-release-notes">更新说明</label><textarea id="desktop-release-notes" aria-label="更新说明" placeholder="填写本次更新内容，发布后向用户展示" value={notes} onChange={event => setNotes(event.target.value)} maxLength={16000} disabled={busy} rows={3} /></div>
      <div className="release-upload-actions">
      <button type="button" className="settings-primary" onClick={upload} disabled={busy || !file || !stableVersion.test(version.trim()) || !snapshot.signing_configured}>上传并校验</button><span role={busy ? 'status' : undefined}>{busy ? action ? '正在处理发布状态…' : progress < 100 ? `上传中 ${progress}%` : '正在校验，请勿重复上传' : '上传时核对版本、系统和架构，校验通过后才能发布。'}</span>
      </div>
    </div>
    <div className="release-list-heading"><div><h2>发布记录</h2><span>共 {records.length} 个更新包</span></div><div className="release-list-actions"><span className="release-select"><CustomSelect aria-label="筛选系统" value={systemFilter} onChange={event => setSystemFilter(event.target.value)}><option value="all">全部系统</option>{Object.entries(systems).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</CustomSelect></span><span className="release-select"><CustomSelect aria-label="筛选架构" value={architectureFilter} onChange={event => setArchitectureFilter(event.target.value)}><option value="all">全部架构</option><option value="x86_64">x64</option><option value="aarch64">ARM64</option></CustomSelect></span><button type="button" className="settings-secondary release-refresh" disabled={busy} onClick={() => refresh()}><RefreshCw size={15} />刷新列表</button></div></div>
    <div className="preview-table-wrap release-table-scroll"><table className="preview-table release-table"><colgroup><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '30%' }} /><col style={{ width: '15%' }} /><col style={{ width: '12%' }} /></colgroup><thead><tr>{['版本', '系统', '架构', '大小', '更新说明', '状态', '操作'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
      {records.slice((page - 1) * 12, page * 12).map(record => {
        const current = snapshot.channels.find(channel => channel.platform === record.platform && channel.release_id === record.id);
        const published = Boolean(current?.published);
        const [system, architecture] = record.platform.split('-');
        return <tr key={record.id}><td><strong title={record.version}>{record.version}</strong></td><td>{systems[system] || system}</td><td>{architectures[architecture] || architecture}</td><td>{(record.size / 1048576).toFixed(1)} MB</td><td><div className="release-notes-cell"><span title={record.notes}>{record.notes || '未填写更新说明'}</span>{record.notes && <button type="button" className="link-button" onClick={() => setDetail(record)}>查看</button>}</div></td><td><span className={`release-status${published ? ' is-published' : ''}`}>{current ? published ? '已发布' : '已撤下' : '未发布'}</span></td><td><button type="button" className="link-button" disabled={busy || (!published && !snapshot.signing_configured)} onClick={() => setAction({ record, kind: published ? 'withdraw' : 'publish' })}>{published ? '撤下' : '发布'}</button><button type="button" className="link-button release-delete" disabled={busy || published} title={published ? '请先撤下再删除' : '删除更新包及发布记录'} onClick={() => setAction({ record, kind: 'delete' })}>删除</button></td></tr>;
      })}
      {records.length === 0 && <tr><td colSpan={7} className="release-empty">此系统和架构暂无更新包，上传校验通过后将在这里显示。</td></tr>}
    </tbody></table></div>
    <div className="zjugis-table-pagination"><span>共 {records.length} 条记录</span><div><button type="button" aria-label="上一页" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {pageCount}</span><button type="button" aria-label="下一页" disabled={page === pageCount} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>
    <Modal className="release-dialog" centered width={640} style={{ maxWidth: 'calc(100vw - 32px)' }} visible={Boolean(detail)} title="更新说明" footer={null} onCancel={() => setDetail(null)}><div className="release-full-notes">{detail?.notes}</div></Modal>
    <Modal className="release-dialog" centered width={560} style={{ maxWidth: 'calc(100vw - 32px)' }} visible={Boolean(action)} title={action?.kind === 'delete' ? '确认删除更新包' : action?.kind === 'publish' ? '确认发布更新' : '确认撤下更新'} confirmLoading={busy} onOk={commit} onCancel={() => { if (!busy) setAction(null); }} okText="确认" cancelText="取消" okButtonProps={{ 'aria-label': '确认', type: action?.kind === 'delete' ? 'danger' : 'primary' }} cancelButtonProps={{ 'aria-label': '取消' }}>
      {action && <p>{labels[action.record.platform]} · {action.record.version}：{action.kind === 'delete' ? '将永久删除此发布记录及更新包文件，无法恢复。不会卸载用户已安装的版本。确认删除？' : action.kind === 'publish' ? '发布后该平台客户端可以检测并下载此版本。请确认已经完成安装和升级验证。' : '撤下后不再提供此版本，不会自动发布更早版本，也不会让已升级客户端降级。'}</p>}
      {action?.confirmOlder && <p className="release-version-warning" role="status">待发布版本 {action.record.version} 低于该平台历史发布版本 {action.previousVersion}，是否继续发布？已安装此版本或更高版本的客户端不会降级。</p>}
    </Modal>
  </section>;
}
