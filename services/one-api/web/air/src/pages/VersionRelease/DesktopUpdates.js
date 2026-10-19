import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal, Space, Table, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { API, isRoot, showError, showSuccess } from '../../helpers';

const labels = { 'windows-x86_64': 'Windows x64', 'darwin-x86_64': 'macOS Intel', 'darwin-aarch64': 'macOS Apple Silicon', 'linux-x86_64': 'Linux x64', 'linux-aarch64': 'Linux ARM64' };

// This page accepts Runner-produced signed bundles, never a private key or arbitrary download URL.
export default function DesktopUpdates() {
  const [snapshot, setSnapshot] = useState({ items: [], channels: [], signing_configured: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [action, setAction] = useState(null);
  const mounted = useRef(false);
  const uploadInput = useRef(null);
  const root = isRoot();
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
    if (root) refresh(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [root]);
  if (!root) return <Typography.Paragraph>仅系统超级管理员可以管理桌面端更新包。</Typography.Paragraph>;
  const upload = async () => {
    if (!file || busy) return;
    setBusy(true); setProgress(0); setFailure('');
    try {
      const payload = new FormData(); payload.append('file', file); payload.append('notes', notes);
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
      const { data } = await API.post(`/api/desktop-updates/${action.record.id}/${action.kind}`);
      if (!data.success) throw new Error(data.message);
      if (!mounted.current) return;
      showSuccess(action.kind === 'publish' ? '已发布，客户端将在检查更新时发现新版' : '已撤下，不会自动回退到旧版本');
      setAction(null); await refresh();
    } catch (error) { if (mounted.current) showError(error.response?.data?.message || error.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section aria-label="桌面端更新包">
    <Typography.Title heading={5}>桌面端更新包</Typography.Title>
    <Typography.Paragraph type="tertiary">上传 GitHub Runner 生成的单平台发布 ZIP。上传只保存草稿，点击发布后对应平台才能检测到更新；其他平台不受影响。</Typography.Paragraph>
    {!snapshot.signing_configured && <p role="status">尚未配置更新公钥。请先由运维配置公钥，上传和发布保持关闭；不要在此上传私钥。</p>}
    {failure && <p role="alert" style={{ color: 'var(--semi-color-danger)' }}>{failure}</p>}
    <div style={{ display: 'grid', gap: 12, maxWidth: 760, margin: '20px 0' }}>
      <label>单平台发布 ZIP<input ref={uploadInput} type="file" accept=".zip" disabled={busy || !snapshot.signing_configured} onChange={event => setFile(event.target.files?.[0] || null)} style={{ display: 'block', marginTop: 8 }} /></label>
      <TextArea aria-label="更新说明" placeholder="填写用户可见的更新说明（纯文本）" value={notes} onChange={setNotes} maxCount={16000} disabled={busy} />
      <Space><Button theme="solid" onClick={upload} loading={busy} disabled={!file || !snapshot.signing_configured}>上传并校验</Button><Button disabled={busy} onClick={() => refresh()}>刷新列表</Button>{busy && <span role="status">{progress < 100 ? `上传中 ${progress}%` : '正在校验，请勿重复上传'}</span>}</Space>
    </div>
    <Table rowKey="id" loading={busy} dataSource={snapshot.items} pagination={{ pageSize: 12 }} empty="尚未上传桌面端更新包" columns={[
      { title: '版本', dataIndex: 'version' },
      { title: '平台', dataIndex: 'platform', render: platform => labels[platform] || platform },
      { title: '大小', dataIndex: 'size', render: size => `${(size / 1048576).toFixed(1)} MB` },
      { title: '更新说明', dataIndex: 'notes', render: value => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</span> },
      { title: '状态', render: (_, record) => {
        const current = snapshot.channels.find(channel => channel.platform === record.platform && channel.release_id === record.id);
        return <Tag color={current?.published ? 'green' : 'grey'}>{current ? current.published ? '已发布' : '已撤下' : '待发布／历史版本'}</Tag>;
      } },
      { title: '操作', render: (_, record) => {
        const published = snapshot.channels.some(channel => channel.release_id === record.id && channel.published);
        return <Button disabled={busy || (!published && !snapshot.signing_configured)} onClick={() => setAction({ record, kind: published ? 'withdraw' : 'publish' })}>{published ? '撤下' : '发布'}</Button>;
      } },
    ]} />
    <Modal visible={Boolean(action)} title={action?.kind === 'publish' ? '确认发布更新' : '确认撤下更新'} confirmLoading={busy} onOk={commit} onCancel={() => { if (!busy) setAction(null); }} okText="确认" cancelText="取消" okButtonProps={{ 'aria-label': '确认' }} cancelButtonProps={{ 'aria-label': '取消' }}>
      {action && <p>{labels[action.record.platform]} · {action.record.version}：{action.kind === 'publish' ? '发布后该平台客户端可以检测并下载此版本。请确认已经完成安装和升级验证。' : '撤下后不再提供此版本，不会自动发布更早版本，也不会让已升级客户端降级。'}</p>}
    </Modal>
  </section>;
}
