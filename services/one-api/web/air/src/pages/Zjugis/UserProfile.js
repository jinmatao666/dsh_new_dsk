import React, { useEffect, useState } from 'react';
import { API } from '../../helpers';
import { ChartNoAxesCombined as Activity, BrainCircuit as Cpu, Layers3 as Zap, Bot as Briefcase, Download, CalendarDays as Calendar, BadgeCheck as Check } from 'lucide-react';
import './UserProfile.css';

const number = (value) => Number(value || 0).toLocaleString('zh-CN');

// 日期键按日历日期处理，避免北京时间午夜转为 UTC 后向前偏移一天。
function activityDays(data) {
  const lookup = key => new Map((data[key]?.days || []).map(item => [item.day, Number(item.count) || 0]));
  const models = lookup('models'), skills = lookup('skills'), experts = lookup('experts');
  const start = Date.parse(`${data.from}T00:00:00Z`);
  const length = Math.max(0, Math.round((Date.parse(`${data.to}T00:00:00Z`) - start) / 86400000) + 1);
  return Array.from({ length }, (_, index) => {
    const day = new Date(start + index * 86400000).toISOString().slice(0, 10);
    return { day, model: models.get(day) || 0, skill: skills.get(day) || 0, expert: experts.get(day) || 0 };
  });
}

function Ranking({ title, items, empty }) {
  const maximum = Math.max(1, ...(items || []).map((item) => Number(item.count) || 0));
  return <section className='user-profile-ranking'>
    <div className='user-profile-section-head'><h3>{title}</h3><span>前 {items?.length || 0} 项</span></div>
    {items?.length ? <ol>{items.map((item, index) => <li key={`${item.name}-${index}`}>
      <span className={`user-profile-rank-position${index === 0 ? ' first' : ''}`}>{index + 1}</span>
      <span className='user-profile-rank-name' title={item.name || '未记录名称'}>{item.name || '未记录名称'}</span>
      <div className='user-profile-track'><i style={{ width: `${Math.max(3, Number(item.count) / maximum * 100)}%` }} /></div>
      <strong>{number(item.count)}</strong>
    </li>)}</ol> : <p className='user-profile-empty'>{empty}</p>}
  </section>;
}

function ActivityTrend({ data }) {
  const days = activityDays(data);
  const maximum = Math.max(1, ...days.map((item) => item.model + item.skill + item.expert));
  const total = days.reduce((sum, item) => sum + item.model + item.skill + item.expert, 0);
  const peak = days.reduce((best, item) => {
    const count = item.model + item.skill + item.expert;
    return count > best.count ? { day: item.day, count } : best;
  }, { day: '', count: 0 });
  return <section className='user-profile-trend'>
    <div className='user-profile-section-head'><h3>使用趋势</h3><span>每日调用与任务</span></div>
    <div className='user-profile-trend-summary'><strong>{number(total)}<small>次活动</small></strong><span>{peak.count ? `峰值 ${peak.day.slice(5)} · ${number(peak.count)} 次` : '暂无活动记录'}</span></div>
    {maximum === 1 && days.every((item) => item.model + item.skill + item.expert === 0)
      ? <p className='user-profile-empty'>这段时间暂无使用记录。</p>
      : <><div className='user-profile-bars' role='img' aria-label='最近 30 天模型调用、技能调用和专家任务趋势'>
        {days.map((item) => <div className='user-profile-bar' key={item.day}
          title={`${item.day}：模型 ${item.model}，技能 ${item.skill}，专家 ${item.expert}`}>
          <i className='model' style={{ height: `${item.model / maximum * 100}%` }} />
          <i className='skill' style={{ height: `${item.skill / maximum * 100}%` }} />
          <i className='expert' style={{ height: `${item.expert / maximum * 100}%` }} />
        </div>)}
      </div><div className='user-profile-axis'><span>{data.from}</span><span>{data.to}</span></div></>}
    <div className='user-profile-legend'><span><i className='model' />模型调用</span><span><i className='skill' />技能调用</span><span><i className='expert' />专家任务</span></div>
  </section>;
}

function ActivityMix({ data }) {
  const values = [
    { key: 'model', label: '模型调用', value: Number(data.models.count) || 0 },
    { key: 'skill', label: '技能调用', value: Number(data.skills.count) || 0 },
    { key: 'expert', label: '专家任务', value: Number(data.experts.count) || 0 },
  ];
  const total = values.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const stops = values.map((item) => {
    const start = total ? cursor / total * 360 : 0;
    cursor += item.value;
    return `${`var(--profile-${item.key})`} ${start}deg ${total ? cursor / total * 360 : 0}deg`;
  });
  return <section className='user-profile-mix'>
    <div className='user-profile-section-head'><h3>活动构成</h3><span>按事件类型</span></div>
    <div className='user-profile-mix-body'>
      <div className='user-profile-donut' style={{ background: total ? `conic-gradient(${stops.join(', ')})` : '#e7eef7' }} role='img' aria-label={`活动总量 ${number(total)} 次`}><div><strong>{number(total)}</strong><small>总活动</small></div></div>
      <div className='user-profile-mix-list'>{values.map((item) => <div key={item.key}><i className={item.key} /><span>{item.label}</span><b>{number(item.value)}</b><small>{total && item.value > 0 && item.value / total < 0.01 ? '<1' : total ? Math.round(item.value / total * 100) : 0}%</small></div>)}</div>
    </div>
  </section>;
}

function ActivityHeatmap({ data }) {
  const days = activityDays(data).map(item => ({ day: item.day, count: item.model + item.skill + item.expert }));
  const maximum = Math.max(1, ...days.map(item => item.count));
  return <section className='user-profile-heatmap'><div className='user-profile-section-head'><h3>活跃日历</h3><span className='user-profile-heatmap-key'>少<span>{[0, 1, 2, 3].map(level => <i key={level} style={{ opacity: 0.2 + level * 0.25 }} />)}</span>多</span></div><div className='user-profile-heatmap-grid' role='img' aria-label='最近 30 天每日活动热力图'>{days.map((item) => <i key={item.day} title={`${item.day}：${number(item.count)} 次`} style={{ '--day-intensity': item.count ? 0.25 + item.count / maximum * 0.75 : 0.06 }} className={item.count ? '' : 'empty'}><span>{item.day.slice(-2)}</span></i>)}</div><div className='user-profile-heatmap-axis'><span>{data.from}</span><span>{data.to}</span></div></section>;
}

function InsightCards({ data }) {
  const total = Number(data.models.count || 0) + Number(data.skills.count || 0) + Number(data.experts.count || 0);
  const days = activityDays(data);
  const activeDays = days.filter(item => item.model + item.skill + item.expert > 0).length;
  return <div className='user-profile-insights'>
    <div><Calendar size={20} aria-hidden='true' /><span>活跃天数</span><strong>{activeDays}<small>/ {days.length} 天</small></strong><p>统计期内有使用记录的天数</p></div>
    <div><Check size={20} aria-hidden='true' /><span>曾安装技能</span><strong>{number(data.downloads.installed_count)}<small>个</small></strong><p>含历史记录，同一技能仅计一次</p></div>
    <div><Activity size={20} aria-hidden='true' /><span>主要活动</span><strong>{total ? (data.models.count >= data.skills.count && data.models.count >= data.experts.count ? '模型调用' : data.skills.count >= data.experts.count ? '技能调用' : '专家任务') : '—'}</strong><p>按统计期内记录数量比较</p></div>
  </div>;
}

function Summary({ data }) {
  const sentences = [];
  if (data.models.count > 0) sentences.push(`近 30 天记录到 ${number(data.models.count)} 次模型调用${data.models.top?.[0]?.name ? `，最常使用 ${data.models.top[0].name}` : ''}。`);
  if (data.skills.count > 0) sentences.push(`触发技能 ${number(data.skills.count)} 次${data.skills.top?.[0]?.name ? `，其中 ${data.skills.top[0].name} 最常用` : ''}。`);
  if (data.experts.count > 0) sentences.push(`启动专家任务 ${number(data.experts.count)} 次${data.experts.top?.[0]?.name ? `，主要使用 ${data.experts.top[0].name}` : ''}。`);
  if (data.downloads.count > 0 || data.downloads.installed_count > 0) sentences.push(`累计下载技能 ${number(data.downloads.count)} 次，有 ${number(data.downloads.installed_count)} 个技能留下安装记录。`);
  return <section className='user-profile-summary'>
    <h3><Activity size={20} aria-hidden='true' />数据摘要</h3>
    <p>{sentences.length ? sentences.join('') : '尚无可用于生成画像的使用记录。'}</p>
    <small>仅汇总已记录的操作，不读取对话内容或文件；模型调用日志关闭时，模型统计可能不完整。下载与安装为累计口径，其余数据为最近 30 天。</small>
  </section>;
}

export default function UserProfile({ user }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [showAllInstalled, setShowAllInstalled] = useState(false);
  useEffect(() => {
    let active = true;
    setShowAllInstalled(false);
    setState({ loading: true, error: '', data: null });
    API.get(`/api/user/${user.id}/profile`).then((response) => {
      if (!active) return;
      if (!response.data?.success) throw new Error(response.data?.message || '画像读取失败');
      setState({ loading: false, error: '', data: response.data.data });
    }).catch((error) => {
      if (active) setState({ loading: false, error: error.message || '画像读取失败', data: null });
    });
    return () => { active = false; };
  }, [user.id]);
  return <div className='user-profile'>
    <header className='user-profile-identity'><div className='user-profile-avatar'>{(user.display_name || user.username || '?').slice(0, 1)}</div>
      <div className='user-profile-identity-copy'><h3>{user.display_name || user.username}<span>{user.role === 100 ? '超级管理员' : user.role === 10 ? '管理员' : '普通用户'}</span></h3><p><span>账号 {user.username}</span><span>ID {user.account_id || `#${user.id}`}</span></p><div className='user-profile-tags'><span>{user.account_type === 2 ? '企业账户' : '个体账户'}</span><span>分组 {user.group || 'default'}</span></div></div>
      <span className={user.status === 1 ? 'user-profile-status active' : 'user-profile-status'}>{user.status === 1 ? '已激活' : '未激活'}</span>
    </header>
    {state.loading ? <p className='user-profile-empty' role='status'>正在汇总用户数据…</p> : state.error
      ? <p className='user-profile-error' role='alert'>{state.error}</p> : <>
        <div className='user-profile-period'><span><Calendar size={18} aria-hidden='true' />{state.data.from} 至 {state.data.to}</span><span>北京时间 · 下载与安装为累计数据</span></div>
        <div className='user-profile-metrics'>
          <div className='model'><span><Cpu size={22} aria-hidden='true' />模型调用</span><strong>{number(state.data.models.count)}<em>次</em></strong><small>输入 {number(state.data.models.prompt_tokens)} / 输出 {number(state.data.models.completion_tokens)} token</small></div>
          <div className='skill'><span><Zap size={22} aria-hidden='true' />技能调用</span><strong>{number(state.data.skills.count)}<em>次</em></strong><small>按实际调用事件统计</small></div>
          <div className='expert'><span><Briefcase size={22} aria-hidden='true' />专家任务</span><strong>{number(state.data.experts.count)}<em>次</em></strong><small>按任务启动事件统计</small></div>
          <div className='download'><span><Download size={22} aria-hidden='true' />技能下载</span><strong>{number(state.data.downloads.count)}<em>次</em></strong><small>累计下载，允许重复计次</small></div>
        </div>
        <InsightCards data={state.data} />
        <div className='user-profile-charts'><ActivityMix data={state.data} /><ActivityTrend data={state.data} /></div>
        <ActivityHeatmap data={state.data} />
        <div className='user-profile-rankings'>
          <Ranking title='常用模型' items={state.data.models.top} empty='暂无模型调用记录' />
          <Ranking title='常用技能' items={state.data.skills.top} empty='暂无技能调用记录' />
          <Ranking title='常用专家' items={state.data.experts.top} empty='暂无专家任务记录' />
        </div>
        <section className='user-profile-downloads'><div className='user-profile-section-head'><h3>已安装技能</h3><span>共 {number(state.data.downloads.installed_count)} 个</span></div>
          {state.data.downloads.top?.length ? <>
            <div className='user-profile-installed-grid'>
              {(() => {
                const visible = showAllInstalled ? state.data.downloads.top : state.data.downloads.top.slice(0, 10);
                const middle = Math.ceil(visible.length / 2);
                return [visible.slice(0, middle), visible.slice(middle)].map((column, index) => <table key={index}>
                  <thead><tr><th>技能名称</th><th>下载次数</th></tr></thead>
                  <tbody>{column.map((item, row) => <tr key={`${index}-${row}-${item.name}`}><td title={item.name}>{item.name}</td><td>{number(item.download_count)} 次</td></tr>)}</tbody>
                </table>);
              })()}
            </div>
            {state.data.downloads.top.length > 10 && <button className='user-profile-installed-toggle' type='button' onClick={() => setShowAllInstalled(value => !value)}>
              {showAllInstalled ? '收起' : `展开全部（${number(state.data.downloads.top.length)}）`}
            </button>}
          </> : <p className='user-profile-empty'>暂无已安装技能</p>}
        </section>
        <Summary data={state.data} />
      </>}
  </div>;
}
