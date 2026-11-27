import React, { useEffect, useState } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { API, showError } from '../../helpers';
import '../Usage/usage.css';

const PAGE_SIZE = 20;

export default function DeploymentInquiries({ embedded = false }) {
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    API.get('/api/feedback/list', {
      params: { page, per_page: PAGE_SIZE, feedback_type: 'deployment_inquiry' },
    }).then(response => {
      if (!response?.data?.success) throw new Error('无法加载部署咨询台账');
      if (current) setRecords({ items: response.data.data.items ?? [], total: response.data.data.total });
    }).catch(err => {
      if (current) setError(err.message);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [page]);

  function openDetails(row) {
    setSelected(row);
    if (!row.read) void updateRead(row.id, true);
  }

  async function updateRead(id, read) {
    setSaving(true);
    try {
      const response = await API.put(`/api/website-deployment-inquiries/${id}/read`, { read });
      if (!response?.data?.success) throw new Error('更新已读状态失败');
      setRecords(previous => ({
        ...previous,
        items: previous.items.map(row => row.id === id ? { ...row, read } : row),
      }));
      setSelected(previous => previous?.id === id ? { ...previous, read } : previous);
      window.dispatchEvent(new Event('deployment-inquiry-read-changed'));
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(records.total / PAGE_SIZE));

  return <section style={embedded ? undefined : { padding: 24 }}>
    {!embedded && <h1>部署咨询台账</h1>}
    {loading && <p className="usage-state" role="status">正在读取部署咨询…</p>}
    {error && <p className="usage-state error" role="alert">{error}</p>}
    {!loading && !error && <>
      <div className="usage-table-wrap"><table className="usage-table inquiry-table">
        <thead><tr><th>姓名</th><th>邮箱</th><th>手机号</th><th>部署需求</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {records.items.map(row => <tr key={row.id}>
            <td>{row.username}</td><td>{row.context}</td><td>{row.phone || "—"}</td>
            <td className="inquiry-summary">{row.content}</td>
            <td>{new Date(row.created_at * 1000).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}</td>
            <td><span className={row.read ? 'inquiry-status' : 'inquiry-status unread'}>{row.read ? '已读' : '未读'}</span></td>
            <td><button type="button" className="inquiry-details" disabled={saving} onClick={() => openDetails(row)}>查看详情</button></td>
          </tr>)}
          {!records.items.length && <tr><td colSpan={7} className="usage-empty">暂无部署咨询</td></tr>}
        </tbody>
      </table></div>
      <div className="inquiry-table-footer">
        <span className="usage-count">共 {records.total} 条部署咨询</span>
        {pageCount > 1 && <div className="usage-pager">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} / {pageCount} 页</span>
        <button type="button" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一页</button>
        </div>}
      </div>
    </>}
    <Modal title="部署咨询详情" className="inquiry-modal" width="min(540px, calc(100vw - 32px))"
      visible={Boolean(selected)} onCancel={() => setSelected(null)}
      footer={selected && <div className="inquiry-modal-actions">
        <span className={selected.read ? 'inquiry-status' : 'inquiry-status unread'}>{selected.read ? '已读' : '未读'}</span>
        <button type="button" className="usage-clear" disabled={saving} onClick={() => updateRead(selected.id, !selected.read)}>
          {saving ? '保存中…' : selected.read ? '标为未读' : '标为已读'}
        </button>
      </div>}>
      {selected && <>
        <dl className="inquiry-contact">
          <div><dt>姓名</dt><dd>{selected.username}</dd></div>
          <div><dt>手机号</dt><dd>{selected.phone || '—'}</dd></div>
          <div><dt>邮箱</dt><dd>{selected.context}</dd></div>
          <div><dt>提交时间</dt><dd>{new Date(selected.created_at * 1000).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}</dd></div>
        </dl>
        <section className="inquiry-requirements">
          <h3>部署需求</h3>
          <p>{selected.content}</p>
        </section>
      </>}
    </Modal>
  </section>;
}
