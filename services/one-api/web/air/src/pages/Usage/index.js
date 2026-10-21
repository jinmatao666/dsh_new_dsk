import React, { useEffect, useMemo, useState } from 'react';
import { API } from '../../helpers';
import AdminPageFrame from '../../components/AdminPageFrame';
import './usage.css';
import CustomSelect from '../../components/CustomSelect';

const tabs = [
  ['skill-stats', '技能统计', 'skill'],
  ['expert-stats', '专家统计', 'expert'],
  ['skill-details', '技能明细', 'skill'],
  ['expert-details', '专家明细', 'expert'],
];
const dateText = date => date.toISOString().slice(0, 10);
const chinaDateText = date => dateText(new Date(date.getTime() + 8 * 60 * 60 * 1000));
const today = new Date();
const initialTo = chinaDateText(today);
const initialFrom = chinaDateText(new Date(today.getTime() - 29 * 86400000));

function bucket(day, period) {
  if (period === 'month') return day.slice(0, 7);
  if (period === 'week') {
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekday);
    return dateText(date);
  }
  return day;
}

function aggregateDays(days, period) {
  const totals = new Map();
  for (const row of days || []) {
    const key = bucket(row.day, period);
    totals.set(key, (totals.get(key) || 0) + row.count);
  }
  return [...totals].map(([label, count]) => ({ label, count }));
}

export default function Usage() {
  const [tab, setTab] = useState('skill-stats');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [period, setPeriod] = useState('day');
  const [page, setPage] = useState(1);
  const [itemID, setItemID] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = tabs.find(([id]) => id === tab);
  const kind = active[2];
  const details = tab.endsWith('details');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const endpoint = details ? 'details' : 'stats';
    API.get(`/api/usage/admin/${endpoint}`, { params: { kind, from, to, page, ...(itemID ? { item_id: itemID } : {}) } })
      .then(response => {
        if (response.data?.success !== true) throw new Error(response.data?.message || '使用记录加载失败');
        if (!cancelled) setData(response.data.data);
      })
      .catch(reason => { if (!cancelled) { setData(null); setError(reason.response?.data?.message || reason.message || '使用记录加载失败，请重试。'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, kind, details, from, to, page, itemID]);

  const trend = useMemo(() => aggregateDays(data?.days, period), [data, period]);
  const maxTrend = Math.max(1, ...trend.map(item => item.count));
  const switchTab = id => { setTab(id); setPage(1); setItemID(''); setData(null); };

  return <AdminPageFrame title="使用统计" description="查看技能与专家的实际使用次数及人员明细。" className="usage-page">
    <nav className="usage-tabs" aria-label="使用统计分类">
      {tabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => switchTab(id)}>{label}</button>)}
    </nav>
    <div className="usage-filters">
      <label>开始日期<input type="date" value={from} max={to} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label>
      <label>结束日期<input type="date" value={to} min={from} onChange={event => { setTo(event.target.value); setPage(1); }} /></label>
      {!details && <label>统计周期<CustomSelect aria-label='统计周期' value={period} onChange={event => setPeriod(event.target.value)}><option value="day">按天</option><option value="week">按周</option><option value="month">按月</option></CustomSelect></label>}
      {itemID && <button type="button" className="usage-clear" onClick={() => setItemID('')}>清除对象筛选</button>}
    </div>
    {loading && <p className="usage-state">正在读取使用记录…</p>}
    {error && <p role="alert" className="usage-state error">{error}</p>}
    {!loading && !error && data && (details ? <>
      <div className="usage-count">共 {data.total || 0} 条使用记录</div>
      <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>人员</th><th>使用时间</th><th>{kind === 'skill' ? '技能名称' : '专家名称'}</th><th>部门</th></tr></thead><tbody>
        {(data.items || []).map(row => <tr key={row.event_id}><td>{row.username || `用户 ${row.user_id}`}</td><td>{new Date(row.occurred_at).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}</td><td>{row.item_name}</td><td>{row.department_name || '未归属部门'}</td></tr>)}
        {(!data.items || data.items.length === 0) && <tr><td colSpan={4} className="usage-empty">所选日期暂无使用记录</td></tr>}
      </tbody></table></div>
      {data.total > 20 && <div className="usage-pager"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.ceil(data.total / 20)} 页</span><button type="button" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(page + 1)}>下一页</button></div>}
    </> : <>
      <div className="usage-total"><span>使用总次数</span><strong>{data.total || 0}</strong><small>按实际发送或任务开始计数</small></div>
      <div className="usage-panels"><section><h2>使用排行 Top 10</h2>{(data.top10 || []).length ? <ol className="usage-ranking">{data.top10.map(row => <li key={row.item_id}><button type="button" onClick={() => { setTab(kind === 'skill' ? 'skill-details' : 'expert-details'); setItemID(row.item_id); setPage(1); }}><span>{row.item_name}</span><b>{row.count}</b></button></li>)}</ol> : <p className="usage-empty">所选日期暂无使用记录</p>}</section>
      <section><h2>按部门</h2><div className="usage-departments">{(data.departments || []).map((row, index) => <div key={row.department_id ?? `none-${index}`}><span>{row.department_name || '未归属部门'}</span><b>{row.count}</b></div>)}</div>{(!data.departments || !data.departments.length) && <p className="usage-empty">暂无部门数据</p>}</section></div>
      <section className="usage-trend"><h2>使用趋势</h2>{trend.length ? trend.map(row => <div className="usage-bar" key={row.label}><time>{row.label}</time><div><span style={{ width: `${100 * row.count / maxTrend}%` }} /></div><b>{row.count}</b></div>) : <p className="usage-empty">所选日期暂无使用记录</p>}</section>
    </>)}
  </AdminPageFrame>;
}
