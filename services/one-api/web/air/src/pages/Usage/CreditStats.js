import React, { useEffect, useState } from 'react';
import { API } from '../../helpers';
import CustomSelect from '../../components/CustomSelect';

const sources = {
  admin: '管理员发放', register: '注册赠送', checkin: '签到赠送', topup: '充值', redeem: '兑换',
  invite: '邀请奖励', purchase: '购买', refund: '退款 / 回收', activity: '活动奖励',
  subscription: '订阅发放', monthly_free: '每月赠送', knowledge: '知识库收益',
  model_reserve: '模型预扣', model_debit: '模型扣款', model_refund: '模型退回', account_adjustment: '账户调整',
  expiry: '到期回收', subscription_reset: '订阅调整', account_transfer: '账户转换',
  skill_reserve: '技能预扣', expert_reserve: '专家预扣', knowledge_reserve: '知识库预扣',
  knowledge_service_reserve: '知识库服务预扣', skill_refund: '技能退回', expert_refund: '专家退回',
  knowledge_refund: '知识库退回', knowledge_service_refund: '知识库服务退回',
  skill_consume: '技能消费', expert_consume: '专家消费', knowledge_consume: '知识库消费', knowledge_service_consume: '知识库服务消费', knowledge_debit: '知识库扣款', account_opening: '账户初始积分', migration: '历史转入', historical_model: '模型消费（历史）',
};

export default function CreditStats({ from, to }) {
  const [draft, setDraft] = useState({ keyword: '', user_id: '', actor_id: '', direction: '', source: '' });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { setPage(1); }, [from, to, filters]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    API.get('/api/usage/admin/credits', { params: { from, to, page, ...filters } }).then(({ data: body }) => {
      if (!body.success) throw new Error(body.message || '积分统计加载失败');
      if (active) setData(body.data);
    }).catch(e => { if (active) { setData(null); setError(e.response?.data?.message || e.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, page, filters, refresh]);
  const amount = value => value == null ? '—' : (value / (data?.quota_per_credit || 1000)).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
  const field = name => ({ value: draft[name], onChange: e => setDraft({ ...draft, [name]: e.target.value }) });
  return <section aria-label="积分统计">
    <form className="usage-filters credit-filters" onSubmit={e => { e.preventDefault(); setFilters({ ...draft }); setPage(1); }}>
      <label className="credit-search">搜索<input placeholder="用户名、姓名、手机、邮箱、单位、部门或业务编号" maxLength={100} {...field('keyword')} /></label>
      <label>用户 ID<input type="number" min="1" placeholder="全部用户" {...field('user_id')} /></label>
      <label>操作人 ID<input type="number" min="0" placeholder="全部操作人" {...field('actor_id')} /></label>
      <label>变动方向<CustomSelect aria-label="积分变动方向" {...field('direction')}><option value="">全部</option><option value="in">增加</option><option value="out">减少</option></CustomSelect></label>
      <label>来源<CustomSelect aria-label="积分来源" {...field('source')}><option value="">全部来源</option>{Object.entries(sources).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</CustomSelect></label>
      <button type="submit" className="usage-clear">查询</button>
      <button type="button" className="usage-clear" onClick={() => { const empty = { keyword: '', user_id: '', actor_id: '', direction: '', source: '' }; setDraft(empty); setFilters(empty); setPage(1); }}>重置</button>
      <button type="button" className="usage-clear" onClick={() => setRefresh(v => v + 1)}>刷新</button>
    </form>
    {error && <p role="alert" className="usage-state error">{error}</p>}
    {loading ? <p className="usage-state">正在读取积分台账…</p> : data && <>
      {data.history_status === 'importing' && <p className="credit-hint" role="status">历史台账正在补录，当前统计尚未包含全部历史记录。稍后点击刷新查看。</p>}
      {data.history_status === 'failed' && <p role="alert" className="usage-state error">历史台账补录暂未完成，请检查后台日志；新发生的积分变动正常记录。</p>}
      <div className="credit-summary"><div><span>变动记录</span><strong>{data.total.toLocaleString()}</strong></div><div><span>增加积分</span><strong className="credit-in">+{amount(data.incoming)}</strong></div><div><span>减少积分</span><strong>−{amount(data.outgoing)}</strong></div><div><span>净变动</span><strong>{amount(data.incoming - data.outgoing)}</strong></div></div>
      {data.audit_since > 0 && <p className="credit-hint">完整台账起点：{new Date(data.audit_since * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。更早记录仅补录已有凭证，未留存的变动无法还原。</p>}
      <p className="credit-hint">预扣与退回分别记账；减少积分包含预扣和到期回收，不等同于最终消费。历史补录缺少的余额或操作人显示“—”。</p>
      <div className="usage-table-wrap"><table className="usage-table credit-table"><thead><tr><th>时间（北京时间）</th><th>用户</th><th>单位 / 部门</th><th>操作人</th><th>来源 / 扣分项</th><th>积分变动</th><th>变动前 / 后余额</th><th>业务编号 / 流水号</th></tr></thead><tbody>
        {data.items.map(row => <tr key={row.id}>
          <td className="credit-nowrap">{new Date(row.occurred_at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}{row.historical && <small>历史补录</small>}</td>
          <td><b>{row.display_name || row.username || '已删除用户'}</b><small>{row.org_id ? `企业 ID ${row.org_id}` : `${row.username} · ID ${row.user_id}`}</small></td>
          <td>{row.unit_name || '—'}<small>{row.department_name || '—'}</small></td>
          <td>{row.actor_name || '—'}{row.actor_id > 0 && <small>ID {row.actor_id}</small>}</td>
          <td>{sources[row.source] || row.source}<small>{row.description || '—'}</small>{row.task_state && <small>{({ reserved: '待结算', succeeded: '已结算', failed: '失败已退回', cancelled: '取消已退回', expired: '超时已退回' })[row.task_state] || row.task_state}</small>}</td>
          <td className={`credit-nowrap ${row.delta > 0 ? 'credit-in' : ''}`}>{row.delta > 0 ? '+' : ''}{amount(row.delta)}</td>
          <td className="credit-nowrap">{amount(row.balance_before)}<small>→ {amount(row.balance_after)}</small></td>
          <td className="credit-reference">{row.reference || '—'}<small>流水 #{row.id}</small></td>
        </tr>)}
        {data.items.length === 0 && <tr><td colSpan={8} className="usage-empty">所选条件暂无积分变动</td></tr>}
      </tbody></table></div>
      <div className="usage-pager"><span>共 {data.total} 条</span><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil(data.total / 20))} 页</span><button type="button" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>下一页</button></div>
    </>}
  </section>;
}
