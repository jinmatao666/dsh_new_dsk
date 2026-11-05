import React, { useEffect, useState } from 'react';
import { API } from '../../helpers';
import { formatCreditPrice } from './creditPricing';

function receiptOf(row) {
  try { return row.credit_billing ? JSON.parse(row.credit_billing) : null; }
  catch { return null; }
}

export default function CreditLogs({ refreshKey }) {
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState({ items: [], total: 0, page_size: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError('');
    API.get(`/api/log/credits?p=${page}&keyword=${encodeURIComponent(keyword)}`).then(response => {
      if (!response.data?.success) throw new Error(response.data?.message || '读取积分明细失败');
      if (!disposed) setData(response.data.data);
    }).catch(reason => { if (!disposed) setError(reason.message || '读取积分明细失败'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [page, keyword, refreshKey, retry]);
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const detailReceipt = detail && receiptOf(detail);
  const credits = row => {
    const receipt = receiptOf(row);
    return receipt?.quota_per_unit > 0
      ? `${formatCreditPrice(row.quota / receipt.quota_per_unit)} 积分` : `${row.quota} 内部额度`;
  };
  return <section className='preview-surface credit-logs'>
    <div className='preview-section-head'><div><h2>积分明细</h2><p className='preview-section-note'>按调用记录实际扣分，价格保留调用时快照；历史记录缺少快照时展示原始额度。</p></div>
      <form className='form-inline-actions' onSubmit={event => { event.preventDefault(); setPage(0); setKeyword(draft.trim()); }}>
        <input className='preview-search' aria-label='搜索积分明细' placeholder='用户、模型或请求 ID' value={draft} onChange={event => setDraft(event.target.value)} />
        <button className='preview-button'>搜索</button>
      </form></div>
    {error ? <p role='alert'>{error} <button className='link-button' onClick={() => setRetry(value => value + 1)}>重试</button></p>
      : loading ? <p role='status'>正在读取积分明细…</p> : <>
        <div className='preview-table-wrap'><table className='preview-table'><thead><tr>
          <th>时间</th><th>用户</th><th>模型</th><th>输入 / 输出 Token</th><th>缓存命中 / 创建</th><th>实际扣分</th><th>结算状态</th><th>详情</th>
        </tr></thead><tbody>{data.items.map(row => {
          const receipt = receiptOf(row);
          return <tr key={row.id}><td>{new Date(row.created_at * 1000).toLocaleString()}</td><td>{row.username || row.user_id}</td><td>{row.model_name}</td>
            <td>{row.prompt_tokens} / {row.completion_tokens}</td><td>{row.cache_read_tokens || 0} / {row.cache_write_tokens || 0}</td><td>{credits(row)}</td>
            <td><span className={receipt?.status === 'settled' ? 'tag success' : 'tag'}>{!receipt ? '历史记录' : receipt.status === 'settled' ? '已结算' : '结算待核对'}</span></td>
            <td><button className='link-button' onClick={() => setDetail(row)}>查看</button></td></tr>;
        })}</tbody></table>{data.items.length === 0 && <div className='preview-empty'>暂无积分消费记录</div>}</div>
        <div className='credit-log-pagination'><span>共 {data.total} 条 · 第 {page + 1} / {pages} 页</span><div>
          <button className='preview-button' disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</button>
          <button className='preview-button' disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>下一页</button>
        </div></div>
      </>}
    {detail && <div className='zjugis-modal-backdrop'><div className='zjugis-modal wide' role='dialog' aria-modal='true' aria-label='积分消费详情'>
      <div className='zjugis-modal-head'><h2>积分消费详情</h2><button aria-label='关闭积分详情' onClick={() => setDetail(null)}>×</button></div>
      <p>{detail.username || detail.user_id} · {detail.model_name} · 实际扣除 <strong>{credits(detail)}</strong></p>
      {detailReceipt ? <>
        <p className='credit-pricing-note'>调用时基准：1× = {formatCreditPrice(detailReceipt.base)} 积分／千 Token；分组倍率：{detailReceipt.group}×。</p>
        <table className='preview-table credit-log-breakdown'><thead><tr><th>计费项</th><th>Token 用量</th><th>当时倍率</th><th>单价（积分／千 Token）</th><th>消耗积分（取整前）</th></tr></thead><tbody>
          {(detailReceipt.version >= 2 ? [['输入','input'],['输出','output']] : [['普通输入','input'],['输出','output'],['缓存命中','cache_read'],['缓存创建','cache_write']]).map(([label,key]) => <tr key={key}>
            <td>{label}</td><td>{detailReceipt[`${key}_tokens`]}</td><td>{detailReceipt[key]}×</td>
            <td>{formatCreditPrice(detailReceipt.base * detailReceipt[key])}</td>
            <td>{formatCreditPrice(detailReceipt[`${key}_tokens`] / 1000 * detailReceipt.base * detailReceipt[key] * detailReceipt.group)}</td>
          </tr>)}
        </tbody></table>
        <p className='credit-pricing-note'>分项合计后统一向上取整至 1 / {detailReceipt.quota_per_unit} 积分。{detailReceipt.source === 'legacy' ? '此调用沿用原有模型计费规则。' : ''}</p>
        {detailReceipt.status !== 'settled' && <p role='alert'>结算待核对：{detailReceipt.error}。应结算 {formatCreditPrice(detailReceipt.expected_quota / detailReceipt.quota_per_unit)} 积分。</p>}
        <p className='credit-pricing-note'>会话 ID：{detailReceipt.session_id || '未提供'}</p>
      </> : <p>此历史记录没有完整价格快照，不能还原当时分项单价。</p>}
      <p className='credit-pricing-note'>请求 ID：{detail.request_id || '未提供'}</p>
    </div></div>}
  </section>;
}
