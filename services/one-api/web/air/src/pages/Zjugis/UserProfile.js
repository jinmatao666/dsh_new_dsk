import React, { useEffect, useState } from 'react';
import { API } from '../../helpers';
import './UserProfile.css';

const number = (value) => Number(value || 0).toLocaleString('zh-CN');

function Ranking({ title, items, empty }) {
  const maximum = Math.max(1, ...(items || []).map((item) => Number(item.count) || 0));
  return <section className='user-profile-ranking'>
    <h3>{title}</h3>
    {items?.length ? <ol>{items.map((item, index) => <li key={`${item.name}-${index}`}>
      <span title={item.name || '未记录名称'}>{item.name || '未记录名称'}</span>
      <div className='user-profile-track'><i style={{ width: `${Math.max(3, Number(item.count) / maximum * 100)}%` }} /></div>
      <strong>{number(item.count)}</strong>
    </li>)}</ol> : <p className='user-profile-empty'>{empty}</p>}
  </section>;
}

function ActivityTrend({ data }) {
  const lookup = (items) => new Map((items || []).map((item) => [item.day, Number(item.count) || 0]));
  const models = lookup(data.models?.days);
  const skills = lookup(data.skills?.days);
  const experts = lookup(data.experts?.days);
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(`${data.from}T00:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { day, model: models.get(day) || 0, skill: skills.get(day) || 0, expert: experts.get(day) || 0 };
  });
  const maximum = Math.max(1, ...days.map((item) => item.model + item.skill + item.expert));
  const total = days.reduce((sum, item) => sum + item.model + item.skill + item.expert, 0);
  const peak = days.reduce((best, item) => {
    const count = item.model + item.skill + item.expert;
    return count > best.count ? { day: item.day, count } : best;
  }, { day: '', count: 0 });
  return <section className='user-profile-trend'>
    <div className='user-profile-section-head'><h3>使用趋势</h3><span>最近 30 天</span></div>
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
    <div className='user-profile-legend'><span><i className='model' />模型调用</span><span><i className='skill' />技能调用</span><span><i className='expert' />专家任务</span><b>{number(total)} 次活动 · 峰值 {peak.day || '—'}</b></div>
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
      <div className='user-profile-mix-list'>{values.map((item) => <div key={item.key}><i className={item.key} /><span>{item.label}</span><b>{number(item.value)}</b><small>{total ? Math.round(item.value / total * 100) : 0}%</small></div>)}</div>
    </div>
  </section>;
}

function ActivityHeatmap({ data }) {
  const source = [...(data.models?.days || []), ...(data.skills?.days || []), ...(data.experts?.days || [])];
  const counts = source.reduce((result, item) => result.set(item.day, (result.get(item.day) || 0) + Number(item.count || 0)), new Map());
  const maximum = Math.max(1, ...counts.values());
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(`${data.from}T00:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { day, count: counts.get(day) || 0 };
  });
  return <section className='user-profile-heatmap'><div className='user-profile-section-head'><h3>活跃日历</h3><span>越深表示当日活动越多</span></div><div className='user-profile-heatmap-grid' role='img' aria-label='最近 30 天每日活动热力图'>{days.map((item) => <i key={item.day} title={`${item.day}：${item.count} 次`} style={{ opacity: item.count ? 0.25 + item.count / maximum * 0.75 : 1 }} className={item.count ? '' : 'empty'} />)}</div><div className='user-profile-heatmap-axis'><span>{data.from}</span><span>{data.to}</span></div></section>;
}

function InsightCards({ data }) {
  const total = Number(data.models.count || 0) + Number(data.skills.count || 0) + Number(data.experts.count || 0);
  const activeDays = new Set([...(data.models.days || []), ...(data.skills.days || []), ...(data.experts.days || [])].filter((item) => Number(item.count) > 0).map((item) => item.day)).size;
  const installRate = Number(data.downloads.count) ? Math.round(Number(data.downloads.installed_count) / Number(data.downloads.count) * 100) : 0;
  return <div className='user-profile-insights'>
    <div><span>活跃天数</span><strong>{activeDays}<small>/ 30</small></strong><p>{activeDays > 14 ? '使用节奏稳定' : activeDays > 0 ? '存在阶段性使用' : '暂无活跃记录'}</p></div>
    <div><span>技能安装转化</span><strong>{installRate}<small>%</small></strong><p>{installRate >= 60 ? '下载后安装意愿较高' : '仍有技能待安装'}</p></div>
    <div><span>主要活动</span><strong>{total ? (data.models.count >= data.skills.count && data.models.count >= data.experts.count ? '模型' : data.skills.count >= data.experts.count ? '技能' : '专家') : '—'}</strong><p>按最近 30 天事件量判断</p></div>
  </div>;
}

function Summary({ data }) {
  const sentences = [];
  if (data.models.count > 0) sentences.push(`近 30 天记录到 ${number(data.models.count)} 次模型调用${data.models.top?.[0]?.name ? `，最常使用 ${data.models.top[0].name}` : ''}。`);
  if (data.skills.count > 0) sentences.push(`触发技能 ${number(data.skills.count)} 次${data.skills.top?.[0]?.name ? `，其中 ${data.skills.top[0].name} 最常用` : ''}。`);
  if (data.experts.count > 0) sentences.push(`启动专家任务 ${number(data.experts.count)} 次${data.experts.top?.[0]?.name ? `，主要使用 ${data.experts.top[0].name}` : ''}。`);
  if (data.downloads.count > 0) sentences.push(`累计下载技能 ${number(data.downloads.count)} 次，有 ${number(data.downloads.installed_count)} 个技能留下安装记录。`);
  return <section className='user-profile-summary'>
    <h3>数据摘要</h3>
    <p>{sentences.length ? sentences.join('') : '尚无可用于生成画像的使用记录。'}</p>
    <small>仅汇总已记录的操作，不读取对话内容或文件；模型调用日志关闭时，模型统计可能不完整。下载与安装为累计口径，其余数据为最近 30 天。</small>
  </section>;
}

export default function UserProfile({ user }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    let active = true;
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
      <div><h3>{user.display_name || user.username}</h3><p>{user.username} · {user.account_id || `#${user.id}`} · {user.group || 'default'} · {user.account_type === 2 ? '企业' : '个体'} · {user.role === 100 ? '超级管理员' : user.role === 10 ? '管理员' : '普通用户'}</p></div>
      <span className={user.status === 1 ? 'user-profile-status active' : 'user-profile-status'}>{user.status === 1 ? '已激活' : '未激活'}</span>
    </header>
    {state.loading ? <p className='user-profile-empty' role='status'>正在汇总用户数据…</p> : state.error
      ? <p className='user-profile-error' role='alert'>{state.error}</p> : <>
        <div className='user-profile-period'>统计区间：{state.data.from} 至 {state.data.to}（北京时间）</div>
        <div className='user-profile-metrics'>
          <div><span>模型调用</span><strong>{number(state.data.models.count)}</strong><small>输入 {number(state.data.models.prompt_tokens)} / 输出 {number(state.data.models.completion_tokens)} token</small></div>
          <div><span>技能调用</span><strong>{number(state.data.skills.count)}</strong><small>按实际调用事件统计</small></div>
          <div><span>专家任务</span><strong>{number(state.data.experts.count)}</strong><small>按任务启动事件统计</small></div>
          <div><span>技能下载</span><strong>{number(state.data.downloads.count)}</strong><small>累计 · 已安装 {number(state.data.downloads.installed_count)} 个</small></div>
        </div>
        <InsightCards data={state.data} />
        <ActivityMix data={state.data} />
        <ActivityTrend data={state.data} />
        <ActivityHeatmap data={state.data} />
        <div className='user-profile-rankings'>
          <Ranking title='常用模型' items={state.data.models.top} empty='暂无模型调用记录' />
          <Ranking title='常用技能' items={state.data.skills.top} empty='暂无技能调用记录' />
          <Ranking title='常用专家' items={state.data.experts.top} empty='暂无专家任务记录' />
        </div>
        <section className='user-profile-downloads'><h3>技能下载与安装</h3>
          {state.data.downloads.top?.length ? <div>{state.data.downloads.top.map((item, index) => <p key={`${item.name}-${index}`}><span>{item.name}</span><b>下载 {number(item.count)} 次</b><em>{item.installed ? '已安装' : '未记录安装'}</em></p>)}</div>
            : <p className='user-profile-empty'>暂无技能下载记录</p>}
        </section>
        <Summary data={state.data} />
      </>}
  </div>;
}
