import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Gauge,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
  Settings2,
  ShieldCheck
} from 'lucide-react';
import { API, isAdmin, showError } from '../../helpers';
import { renderNumber, renderQuota } from '../../helpers/render';

const PERIODS = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'today', label: '今天' }
];

// 正式页面使用服务端统计接口；独立 preview HTML 仍用于纯 UI 调试。
const DASHBOARD_DATA_ENABLED = true;
const PREVIEW_LINE_PATH = 'M12 38 C92 44 120 112 220 120 S355 140 450 124 S595 80 748 92';
const PREVIEW_AREA_PATH = `${PREVIEW_LINE_PATH} L748 178 L12 178 Z`;

const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const dateKey = (value) => String(value || '').slice(0, 10);

function getRange(period) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  if (period === 'today') start.setHours(0, 0, 0, 0);
  else start.setDate(start.getDate() - (period === '30d' ? 29 : 6));
  start.setHours(0, 0, 0, 0);
  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000),
    days: Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day.toISOString().slice(0, 10);
    })
  };
}

function formatDay(value) {
  const [, month, day] = value.split('-');
  return `${month}/${day}`;
}

function makeLinePath(values, width = 760, height = 190, padding = 12) {
  if (!values.length) return { line: '', area: '' };
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const points = values.map((value, index) => {
    const x = padding + ((width - padding * 2) * index) / Math.max(values.length - 1, 1);
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return {
    line: `M${points.join(' L')}`,
    area: `M${points[0]} L${points.slice(1).join(' L')} L${width - padding} ${height - padding} L${padding} ${height - padding} Z`
  };
}

const EmptyState = ({ text }) => <div className="zjugis-empty-state">{text}</div>;

const Home = () => {
  const admin = isAdmin();
  const [period, setPeriod] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [status, setStatus] = useState(() => {
    try { return JSON.parse(localStorage.getItem('status') || '{}'); } catch { return {}; }
  });

  const loadData = useCallback(async (manual = false) => {
    const range = getRange(period);
    if (manual) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const query = `start_timestamp=${range.start}&end_timestamp=${range.end}&granularity=day`;
      const requests = [API.get('/api/status'), API.get(`/api/user/dashboard?${query}`)];
      if (admin) requests.push(API.get(`/api/log/ranking?range=${period === 'today' ? '7d' : period}&sort=tokens&limit=5`));
      const results = await Promise.allSettled(requests);
      const statusResult = results[0];
      if (statusResult.status === 'fulfilled' && statusResult.value.data?.success) {
        const nextStatus = statusResult.value.data.data || {};
        setStatus(nextStatus);
        localStorage.setItem('status', JSON.stringify(nextStatus));
      }
      const dashboardResult = results[1];
      if (dashboardResult.status !== 'fulfilled' || !dashboardResult.value.data?.success) {
        throw new Error(dashboardResult.value?.data?.message || '统计数据暂时不可用');
      }
      setRows(Array.isArray(dashboardResult.value.data.data) ? dashboardResult.value.data.data : []);
      if (admin && results[2]?.status === 'fulfilled' && results[2].value.data?.success) {
        setRanking(Array.isArray(results[2].value.data.data) ? results[2].value.data.data : []);
      }
    } catch (requestError) {
      setError(requestError?.message || '统计数据暂时不可用');
      if (!manual) showError(requestError?.message || '获取看板数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [admin, period]);

  useEffect(() => {
    if (!DASHBOARD_DATA_ENABLED) {
      setLoading(false);
      return undefined;
    }
    loadData();
    return undefined;
  }, [loadData]);

  const range = useMemo(() => getRange(period), [period]);
  const summary = useMemo(() => rows.reduce((result, row) => {
    const hasFailureData = Object.prototype.hasOwnProperty.call(row, 'FailedCount') || Object.prototype.hasOwnProperty.call(row, 'failed_count');
    return {
      requests: result.requests + toNumber(row.RequestCount),
      quota: result.quota + toNumber(row.Quota),
      tokens: result.tokens + toNumber(row.PromptTokens) + toNumber(row.CompletionTokens),
      failed: result.failed + toNumber(row.FailedCount || row.failed_count),
      failureKnown: result.failureKnown || hasFailureData
    };
  }, { requests: 0, quota: 0, tokens: 0, failed: 0, failureKnown: false }), [rows]);

  const modelRows = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      const name = row.ModelName || row.model_name || '未命名模型';
      const current = map.get(name) || { name, requests: 0, tokens: 0, quota: 0 };
      current.requests += toNumber(row.RequestCount);
      current.tokens += toNumber(row.PromptTokens) + toNumber(row.CompletionTokens);
      current.quota += toNumber(row.Quota);
      map.set(name, current);
    });
    return [...map.values()].sort((a, b) => b.tokens - a.tokens);
  }, [rows]);

  const daily = useMemo(() => range.days.map((day) => rows
    .filter((row) => dateKey(row.Day || row.day || row.Date) === day)
    .reduce((total, row) => total + toNumber(row.RequestCount), 0)), [range.days, rows]);
  const paths = useMemo(() => makeLinePath(daily), [daily]);
  const maxDaily = Math.max(...daily, 0);
  const serviceReady = DASHBOARD_DATA_ENABLED ? Boolean(status.version) && !error : true;
  const successRate = summary.requests > 0 && summary.failureKnown
    ? `${Math.max(0, Math.round(((summary.requests - summary.failed) / summary.requests) * 100))}%`
    : '—';

  return (
    <main className="zjugis-dashboard" aria-busy={loading}>
      <header className="zjugis-dashboard-header">
        <div>
          <div className="zjugis-eyebrow"><LayoutDashboard size={14} /> ANALYTICAL BOARD</div>
          <h1>服务分析看板</h1>
          <p>模型调用、用户用量与平台健康状态的实时概览。</p>
        </div>
        <div className="zjugis-header-actions">
          <label className="zjugis-period" htmlFor="zjugis-period-select">
            <span>统计周期</span>
            <select id="zjugis-period-select" value={period} onChange={(event) => setPeriod(event.target.value)}>
              {PERIODS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
            <ChevronDown size={14} />
          </label>
          <button className="zjugis-refresh-button" type="button" onClick={() => loadData(true)} disabled={!DASHBOARD_DATA_ENABLED || refreshing} aria-label="刷新看板">
            <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} />
          </button>
          <span className={`zjugis-status ${serviceReady ? 'is-ready' : ''}`}><span className="zjugis-status-dot" /> {DASHBOARD_DATA_ENABLED ? (serviceReady ? '服务在线' : '等待服务') : '界面预览'}</span>
        </div>
      </header>

      {error && <div className="zjugis-dashboard-alert" role="alert">{error} <button type="button" onClick={() => loadData(true)}>重试</button></div>}

      <section className="zjugis-board-grid">
        <article className="zjugis-chart-card zjugis-surface-card">
          <div className="zjugis-card-heading"><div><span className="zjugis-card-kicker">MODEL OPERATIONS</span><h2>模型服务概览</h2></div><Link className="zjugis-card-link" to="/log">查看日志 <ArrowUpRight size={14} /></Link></div>
          <div className="zjugis-chart-metrics">
            <div><strong>{loading ? '…' : renderNumber(summary.requests)}</strong><span>请求总量</span></div>
            <div><strong>{loading ? '…' : renderNumber(summary.tokens)}</strong><span>Token 消耗</span></div>
            <div><strong>{loading ? '…' : renderQuota(summary.quota)}</strong><span>额度消耗</span></div>
            <div><strong>{loading ? '…' : successRate}</strong><span>成功率</span></div>
          </div>
          <div className="zjugis-chart-area" aria-label="模型调用趋势">
            {rows.length > 0 || !DASHBOARD_DATA_ENABLED ? <svg viewBox="0 0 760 190" preserveAspectRatio="none" role="img"><defs><linearGradient id="zjugisChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#77b9ff" stopOpacity="0.6" /><stop offset="100%" stopColor="#d8ecff" stopOpacity="0.08" /></linearGradient></defs><path d={DASHBOARD_DATA_ENABLED ? paths.area : PREVIEW_AREA_PATH} fill="url(#zjugisChartFill)" /><path d={DASHBOARD_DATA_ENABLED ? paths.line : PREVIEW_LINE_PATH} fill="none" stroke="#3d89ef" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg> : <EmptyState text={loading ? '正在读取服务统计…' : '当前周期暂无调用记录'} />}
            <div className="zjugis-chart-axis"><span>{range.days[0] ? formatDay(range.days[0]) : ''}</span><span>{maxDaily ? `峰值 ${renderNumber(maxDaily)} 次` : '暂无历史统计'}</span><span>{range.days[range.days.length - 1] ? formatDay(range.days[range.days.length - 1]) : ''}</span></div>
          </div>
          <div className="zjugis-stat-strip"><div><strong>{modelRows.length || '—'}</strong><span>活跃模型</span></div><div><strong>{admin ? (ranking.length || '—') : '—'}</strong><span>{admin ? '活跃用户' : '用户排行'}</span></div><div><strong>{summary.failureKnown ? (summary.failed || '—') : '—'}</strong><span>失败请求</span></div></div>
        </article>

        <aside className="zjugis-copilot-card"><div className="zjugis-copilot-brand"><img src="/zjugis-mark.png" alt="" /><span>ZJUGIS</span></div><h2>Harness<br /><em>Co-Pilot</em></h2><div className="zjugis-orb" aria-hidden="true"><div className="zjugis-orb-core" /></div><div className="zjugis-copilot-footer"><div><strong>{status.version || '—'}</strong><span>{status.system_name || '服务版本'}</span></div><Link to="/config/model" aria-label="打开模型配置"><ArrowUpRight size={18} /></Link></div></aside>
      </section>

      <section className="zjugis-lower-grid">
        <article className="zjugis-surface-card zjugis-activity-card"><div className="zjugis-card-heading"><div><span className="zjugis-card-kicker">MODEL USAGE</span><h2>模型使用情况</h2></div><span className="zjugis-live-label"><span />真实数据</span></div>{modelRows.length > 0 ? <div className="zjugis-model-list">{modelRows.slice(0, 5).map((model) => <div className="zjugis-model-row" key={model.name}><span className="zjugis-model-avatar"><Cpu size={15} /></span><strong title={model.name}>{model.name}</strong><span>{renderNumber(model.requests)} 次请求</span><span>{renderNumber(model.tokens)} tokens</span><Link to="/log" aria-label={`查看 ${model.name} 日志`}><ArrowUpRight size={15} /></Link></div>)}</div> : <EmptyState text={loading ? '正在读取模型使用情况…' : '当前周期暂无模型调用记录'} />}<Link className="zjugis-section-link" to="/config/model">管理模型服务 <ArrowUpRight size={14} /></Link></article>
        <article className="zjugis-surface-card zjugis-health-card"><div className="zjugis-card-heading"><div><span className="zjugis-card-kicker">SYSTEM HEALTH</span><h2>运行状态</h2></div><CheckCircle2 className={serviceReady ? 'zjugis-health-check' : 'zjugis-health-warning'} size={21} /></div><div className="zjugis-health-row"><span><Gauge size={16} /> API 服务</span><strong className={serviceReady ? '' : 'is-warning'}>{serviceReady ? '正常' : '待连接'}</strong></div><div className="zjugis-health-row"><span><ShieldCheck size={16} /> 访问控制</span><strong>已启用</strong></div><div className="zjugis-health-row"><span><ListChecks size={16} /> 日志记录</span><strong>{summary.requests ? '有记录' : '待产生'}</strong></div><Link className="zjugis-settings-link" to="/setting/personal"><Settings2 size={15} /> 账户设置 <ArrowUpRight size={14} /></Link></article>
      </section>

      {admin && ranking.length > 0 && <section className="zjugis-surface-card zjugis-ranking-card"><div className="zjugis-card-heading"><div><span className="zjugis-card-kicker">USAGE RANKING</span><h2>用户使用排行</h2></div><Link className="zjugis-card-link" to="/user">管理用户 <ArrowUpRight size={14} /></Link></div><div className="zjugis-ranking-list">{ranking.map((item, index) => <Link to="/log" className="zjugis-ranking-row" key={item.user_id || item.username || index}><span className="zjugis-ranking-index">{index + 1}</span><span className="zjugis-ranking-name">{item.username || '未知用户'}</span><span>{renderNumber(item.tokens || 0)} tokens</span><span>{renderNumber(item.request_count || 0)} 次请求</span><ArrowUpRight size={14} /></Link>)}</div></section>}
      <footer className="zjugis-dashboard-footer"><span><Activity size={14} /> ZJUGIS Harness 管理工作台</span><span>数据来自当前服务端统计接口</span></footer>
    </main>
  );
};

export default Home;
