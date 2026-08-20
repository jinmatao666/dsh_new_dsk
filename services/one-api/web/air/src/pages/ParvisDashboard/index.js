import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Col, DatePicker, Empty, Row, Spin, Table, Tag, Tooltip } from '@douyinfe/semi-ui';
import { IconArrowUp, IconArrowDown, IconHelpCircle } from '@douyinfe/semi-icons';
import VChart from '@visactor/vchart';
import { API, showError } from '../../helpers';
import Dashboard from '../Dashboard';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';

const formatAmount = (fen) => '¥' + (fen / 100).toFixed(2);
const formatAmountShort = (fen) => {
  const yuan = fen / 100;
  if (yuan >= 10000) return '¥' + (yuan / 10000).toFixed(1) + '万';
  return '¥' + yuan.toFixed(0);
};
const formatNumber = (num) => {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return num?.toLocaleString() || '0';
};
const calcChangeRate = (cur, prev) => {
  if (!prev || prev === 0) return null;
  return ((cur - prev) / prev * 100).toFixed(1);
};

const cardStyle = {
  borderRadius: 10, border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};
const headerStyle = { padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' };
const bodyStyle = { padding: '12px 16px 16px' };

const ChangeIndicator = ({ rate }) => {
  if (rate === null || rate === undefined) return null;
  const num = parseFloat(rate);
  if (isNaN(num) || num === 0) return null;
  const isUp = num > 0;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2,
      color: isUp ? '#05CD99' : '#FF5E7D',
      background: isUp ? 'rgba(5,205,153,0.08)' : 'rgba(255,94,125,0.08)',
      padding: '2px 6px', borderRadius: 4,
    }}>
      {isUp ? <IconArrowUp size="extra-small" /> : <IconArrowDown size="extra-small" />}
      {Math.abs(num)}%
    </span>
  );
};

const InfoTip = ({ text }) => (
  <Tooltip content={text} position="top">
    <IconHelpCircle size="small" style={{ color: '#C0C7D6', cursor: 'help', marginLeft: 4, verticalAlign: 'middle' }} />
  </Tooltip>
);

const KpiCard = ({ label, value, sub, changeRate, tip }) => (
  <Card bodyStyle={{ padding: '18px 20px' }} style={cardStyle}>
    <div style={{ fontSize: 16, color: '#8F9BBA', fontWeight: 500, marginBottom: 8, letterSpacing: 0.5 }}>
      {label}{tip && <InfoTip text={tip} />}
    </div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#1B2559', lineHeight: 1.1,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif' }}>{value}</div>
      <ChangeIndicator rate={changeRate} />
    </div>
    {sub && <div style={{ fontSize: 11, color: '#A3AED0', marginTop: 6, fontWeight: 500 }}>{sub}</div>}
  </Card>
);

const ChartCard = ({ title, tip, children }) => (
  <Card
    title={<span>{title}{tip && <InfoTip text={tip} />}</span>}
    headerStyle={headerStyle} bodyStyle={bodyStyle} style={cardStyle}>
    {children}
  </Card>
);

const STATUS_MAP = {
  paid: { text: '已支付', color: 'green' },
  pending: { text: '待支付', color: 'orange' },
  cancelled: { text: '已取消', color: 'grey' },
  expired: { text: '已过期', color: 'red' },
};
const PAY_TYPE_MAP = { wechat: '微信', alipay: '支付宝' };

const PLATFORM_LABEL_MAP = {
  'mac-arm': 'macOS (Apple Silicon)',
  'mac-intel': 'macOS (Intel)',
  windows: 'Windows',
  unknown: '未知',
};

const orderColumns = [
  { title: '订单号', dataIndex: 'order_no', width: 180,
    render: v => <span style={{ fontSize: 12, fontFamily: 'SF Mono, monospace', color: '#4318FF' }}>{v}</span> },
  { title: '用户', dataIndex: 'username', width: 100 },
  { title: '套餐', dataIndex: 'package_name', width: 120 },
  { title: '金额', dataIndex: 'amount', width: 100,
    render: v => <span style={{ fontWeight: 600 }}>{formatAmount(v)}</span> },
  { title: '支付方式', dataIndex: 'pay_type', width: 90, render: v => PAY_TYPE_MAP[v] || v },
  { title: '状态', dataIndex: 'status', width: 90,
    render: v => { const s = STATUS_MAP[v] || { text: v, color: 'default' };
      return <Tag color={s.color} size="small" style={{ borderRadius: 4 }}>{s.text}</Tag>; }},
  { title: '时间', dataIndex: 'created_at', width: 160,
    render: v => v ? new Date(v).toLocaleString('zh-CN') : '-' },
];

const spenderColumns = [
  { title: '排名', dataIndex: 'rank', width: 60,
    render: (_, __, i) => {
      const colors = ['#FFB547', '#A3AED0', '#CD7F32'];
      return i < 3
        ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%', background: colors[i], color: '#fff',
            fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
        : <span style={{ color: '#A3AED0', fontWeight: 500 }}>{i + 1}</span>;
    }},
  { title: '用户', dataIndex: 'username', width: 120 },
  { title: '订单数', dataIndex: 'order_count', width: 80,
    render: v => <span style={{ fontWeight: 500 }}>{v}</span> },
  { title: '累计消费', dataIndex: 'total_amount', width: 120,
    render: v => <span style={{ fontWeight: 600, color: '#4318FF' }}>{formatAmount(v)}</span> },
];

const axisStyle = {
  label: { style: { fontSize: 10, fill: '#A3AED0' } },
  grid: { style: { lineDash: [3, 3], stroke: 'rgba(0,0,0,0.04)' } },
  domainLine: { visible: false }, tick: { visible: false },
};

const ParvisDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');
  const [customRange, setCustomRange] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);

  const chartRefs = {
    user: useRef(null), revenue: useRef(null), pkg: useRef(null),
    comp: useRef(null), funnel: useRef(null), payType: useRef(null), orderStatus: useRef(null),
    downloadPlatform: useRef(null), version: useRef(null),
    deviceVersion: useRef(null), devicePlatform: useRef(null),
    deviceOs: useRef(null), deviceArch: useRef(null),
  };
  const chartInstances = useRef({});

  const fetchData = async (p, range) => {
    setLoading(true);
    try {
      let url = `/api/parvis-dashboard?period=${p}`;
      if (p === 'custom' && range && range.length === 2) {
        const fmt = d => d.toISOString().split('T')[0];
        url += `&start=${fmt(range[0])}&end=${fmt(range[1])}`;
      }
      const res = await API.get(url);
      if (res.data.success) setDashboardData(res.data.data);
      else showError(res.data.message || '获取数据失败');
    } catch { showError('获取数据失败'); }
    setLoading(false);
  };

  useEffect(() => {
    fetchData(period);
    return () => Object.values(chartInstances.current).forEach(c => c?.release());
  }, []);

  useEffect(() => {
    if (dashboardData) setTimeout(() => renderAllCharts(), 80);
  }, [dashboardData]);

  const handlePeriodChange = (p) => { setPeriod(p); if (p !== 'custom') fetchData(p); };
  const handleCustomRange = (dates) => {
    if (dates && dates.length === 2) { setCustomRange(dates); fetchData('custom', dates); }
  };

  const renderAllCharts = () => {
    const d = dashboardData;
    renderUserChart(d.user_trend || []);
    renderRevenueChart(d.revenue_trend || []);
    renderPieChart('pkg', d.package_distribution || [], item => ({ name: item.name || '未知', value: item.count }),
      ['#4318FF', '#6C63FF', '#00B5D8', '#05CD99', '#FFB547', '#FF5E7D']);
    renderCompositionChart(d.user_composition);
    renderFunnelChart(d.conversion_funnel);
    renderPieChart('payType', d.pay_type_distribution || [],
      item => ({ name: PAY_TYPE_MAP[item.pay_type] || item.pay_type, value: item.count }),
      ['#05CD99', '#4318FF', '#FFB547']);
    renderPieChart('orderStatus', d.order_status_distribution || [],
      item => ({ name: (STATUS_MAP[item.status] || { text: item.status }).text, value: item.count }),
      ['#05CD99', '#FFB547', '#A3AED0', '#FF5E7D']);
    renderPieChart('downloadPlatform', d.homepage_stats?.platform_dist || [],
      item => ({ name: PLATFORM_LABEL_MAP[item.platform] || item.platform, value: item.count }),
      ['#4318FF', '#00B5D8', '#05CD99', '#A3AED0']);

    renderPieChart('version', d.version_dist || [],
      item => ({ name: item.version === '未知' ? '未知版本' : 'v' + item.version, value: item.users }),
      ['#4318FF', '#6C63FF', '#00B5D8', '#05CD99', '#FFB547', '#FF5E7D', '#A3AED0'], '人');

    const dev = d.device_stats || {};
    renderBarChart('deviceVersion', (dev.version_dist || []).slice(0, 12),
      item => ({ name: item.name, value: item.count }), '#4318FF');
    renderPieChart('devicePlatform', dev.platform_dist || [],
      item => ({ name: PLATFORM_LABEL_MAP[item.name] || item.name, value: item.count }),
      ['#4318FF', '#00B5D8', '#05CD99', '#A3AED0'], '人');
    renderBarChart('deviceOs', (dev.os_dist || []).slice(0, 12),
      item => ({ name: item.name, value: item.count }), '#00B5D8');
    renderPieChart('deviceArch', dev.arch_dist || [],
      item => ({ name: item.name, value: item.count }),
      ['#6C63FF', '#FFB547', '#05CD99', '#A3AED0'], '人');
  };

  const renderBarChart = (key, data, mapFn, color) => {
    const values = data.map(mapFn).filter(v => v.value > 0);
    if (!values.length) return;
    makeChart(key, {
      type: 'bar', data: [{ values }],
      xField: 'name', yField: 'value',
      bar: { style: { cornerRadius: [4, 4, 0, 0], fill: color, fillOpacity: 0.85 } },
      axes: [
        { orient: 'bottom', ...axisStyle, label: { ...axisStyle.label, autoRotate: true } },
        { orient: 'left', ...axisStyle, title: { visible: false } },
      ],
      legends: { visible: false },
      tooltip: { mark: { content: [{ key: d => d?.name || '', value: d => formatNumber(d?.value) + ' 人' }] } },
      padding: { left: 8, right: 8, top: 8, bottom: 8 },
    });
  };

  const makeChart = (key, spec) => {
    const dom = chartRefs[key]?.current;
    if (!dom) return;
    chartInstances.current[key]?.release();
    const c = new VChart(spec, { dom });
    c.renderSync();
    chartInstances.current[key] = c;
  };

  const renderUserChart = (data) => {
    if (!data.length) return;
    makeChart('user', {
      type: 'common',
      series: [
        { type: 'bar', data: { id: 'newUsers', values: data.map(d => ({ date: d.date.slice(5), value: d.new_users })) },
          name: '新增用户', xField: 'date', yField: 'value', seriesField: 'name',
          bar: { style: { cornerRadius: [4, 4, 0, 0], fillOpacity: 0.85 } } },
        { type: 'line', data: { id: 'totalUsers', values: data.map(d => ({ date: d.date.slice(5), value: d.total_users })) },
          name: '累计用户', xField: 'date', yField: 'value', seriesField: 'name',
          line: { style: { lineWidth: 2, curveType: 'monotone' } },
          point: { style: { size: 4, fillOpacity: 0.8 } } },
      ],
      color: ['#4318FF', '#00B5D8'],
      axes: [{ orient: 'bottom', ...axisStyle }, { orient: 'left', ...axisStyle, title: { visible: false } }],
      legends: { visible: true, orient: 'bottom', padding: { top: 8 },
        item: { shape: { style: { symbolType: 'circle', size: 8 } } } },
      tooltip: { mark: { content: [{ key: d => d?.name || '', value: d => formatNumber(d?.value) + ' 人' }] } },
      padding: { left: 8, right: 8, top: 8, bottom: 0 },
    });
  };

  const renderRevenueChart = (data) => {
    if (!data.length) return;
    makeChart('revenue', {
      type: 'common',
      series: [
        { type: 'bar', data: { id: 'amt', values: data.map(d => ({ date: d.date.slice(5), value: d.amount / 100 })) },
          name: '收入(元)', xField: 'date', yField: 'value', seriesField: 'name',
          bar: { style: { cornerRadius: [4, 4, 0, 0], fillOpacity: 0.85 } } },
        { type: 'line', data: { id: 'ord', values: data.map(d => ({ date: d.date.slice(5), value: d.order_count })) },
          name: '订单量', xField: 'date', yField: 'value', seriesField: 'name',
          line: { style: { lineWidth: 2, curveType: 'monotone' } },
          point: { style: { size: 4, fillOpacity: 0.8 } } },
      ],
      color: ['#05CD99', '#FFB547'],
      axes: [
        { orient: 'bottom', ...axisStyle },
        { orient: 'left', ...axisStyle, title: { visible: false } },
        { orient: 'right', ...axisStyle, title: { visible: false }, grid: { visible: false } },
      ],
      legends: { visible: true, orient: 'bottom', padding: { top: 8 },
        item: { shape: { style: { symbolType: 'circle', size: 8 } } } },
      padding: { left: 8, right: 8, top: 8, bottom: 0 },
    });
  };

  const renderPieChart = (key, data, mapFn, colors, unit = '单') => {
    const values = data.map(mapFn).filter(v => v.value > 0);
    if (!values.length) return;
    makeChart(key, {
      type: 'pie', data: [{ values }],
      valueField: 'value', categoryField: 'name',
      outerRadius: 0.75, innerRadius: 0.52,
      pie: { style: { cornerRadius: 3, padAngle: 0.02 } },
      color: colors,
      label: { visible: true, position: 'outside', style: { fontSize: 11, fill: '#8F9BBA' },
        line: { style: { stroke: '#E0E5F2' } } },
      legends: { visible: true, orient: 'bottom', padding: { top: 8 },
        item: { shape: { style: { symbolType: 'circle', size: 8 } } } },
      tooltip: { mark: { content: [{ key: d => d?.name || '', value: d => (d?.value ?? 0) + ' ' + unit }] } },
      padding: 4,
    });
  };

  const renderCompositionChart = (comp) => {
    if (!comp) return;
    const values = [
      { name: '活跃付费', value: comp.active_paid },
      { name: '活跃免费', value: comp.active_free },
      { name: '沉默用户', value: comp.silent },
      { name: '流失用户', value: comp.churned },
    ].filter(v => v.value > 0);
    if (!values.length) return;
    makeChart('comp', {
      type: 'pie', data: [{ values }],
      valueField: 'value', categoryField: 'name',
      outerRadius: 0.75, innerRadius: 0.52,
      pie: { style: { cornerRadius: 3, padAngle: 0.02 } },
      color: ['#4318FF', '#00B5D8', '#FFB547', '#FF5E7D'],
      label: { visible: true, position: 'outside', style: { fontSize: 11, fill: '#8F9BBA' },
        line: { style: { stroke: '#E0E5F2' } } },
      legends: { visible: true, orient: 'bottom', padding: { top: 8 },
        item: { shape: { style: { symbolType: 'circle', size: 8 } } } },
      tooltip: { mark: { content: [{ key: d => d?.name || '', value: d => formatNumber(d?.value) + ' 人' }] } },
      padding: 4,
    });
  };

  const renderFunnelChart = (funnel) => {
    if (!funnel) return;
    makeChart('funnel', {
      type: 'funnel', data: [{ values: [
        { stage: '注册用户', value: funnel.registered },
        { stage: '首次请求', value: funnel.first_request },
        { stage: '首次付费', value: funnel.first_paid },
      ] }],
      categoryField: 'stage', valueField: 'value',
      funnel: { style: { cornerRadius: 4 } },
      color: ['#4318FF', '#00B5D8', '#05CD99'],
      label: { visible: true, style: { fontSize: 12, fill: '#fff', fontWeight: 500 } },
      legends: { visible: false },
      tooltip: { mark: { content: [{ key: d => d?.stage || '', value: d => formatNumber(d?.value) + ' 人' }] } },
      padding: { left: 20, right: 20, top: 4, bottom: 4 },
    });
  };

  // --- data ---
  const kpi = dashboardData?.kpi;
  const periodLabel = period === 'today' ? '今日' : period === '7d' ? '近7日'
    : period === '30d' ? '近30日'
    : customRange ? `${customRange[0].toLocaleDateString('zh-CN')} ~ ${customRange[1].toLocaleDateString('zh-CN')}` : '自定义';

  const userKpiItems = kpi ? [
    { label: '新增用户', value: formatNumber(kpi.new_users_period),
      tip: '选定时间内新注册的用户数量，环比为与上一个同等时间段对比',
      sub: '选定时间内新注册用户',
      changeRate: calcChangeRate(kpi.new_users_period, kpi.new_users_prev) },
    { label: '总用户数', value: formatNumber(kpi.total_users),
      tip: '平台从上线至今的累计注册用户总数',
      sub: '平台累计注册用户' },
    { label: '活跃用户', value: formatNumber(kpi.active_users),
      tip: '选定时间内有实际 API 调用消费日志的去重用户数',
      sub: '选定时间内有实际调用的用户',
      changeRate: calcChangeRate(kpi.active_users, kpi.active_users_prev) },
    { label: '新增活跃用户', value: formatNumber(kpi.new_active_users),
      tip: '选定时间内新注册、且在同一时间内有实际 API 调用消费的去重用户数',
      sub: '选定时间内新增且有调用的用户',
      changeRate: calcChangeRate(kpi.new_active_users, kpi.new_active_prev) },
  ] : [];

  const homepage = dashboardData?.homepage_stats;
  const device = dashboardData?.device_stats;
  const versionDist = dashboardData?.version_dist;
  const homepageKpiItems = homepage ? [
    { label: '首页访问', value: formatNumber(homepage.visit_count),
      tip: '选定时间内官网首页的访问次数（PV），同一浏览器会话只计一次',
      sub: `${formatNumber(homepage.visit_devices)} 台去重设备` },
    { label: '下载点击', value: formatNumber(homepage.download_count),
      tip: '选定时间内点击下载按钮的总次数（含各平台）',
      sub: `${formatNumber(homepage.download_devices)} 台设备点击下载` },
    { label: '访问转下载', value: homepage.visit_count > 0
        ? (homepage.download_count / homepage.visit_count * 100).toFixed(1) + '%' : '-',
      tip: '下载点击数 ÷ 首页访问数，反映首页到下载的转化效率',
      sub: '下载点击 ÷ 首页访问' },
  ] : [];

  const revenueKpiItems = kpi ? [
    { label: '付费用户', value: formatNumber(kpi.paid_users_period),
      tip: '选定时间内至少完成过一笔支付的用户数，付费率 = 付费用户 ÷ 总用户',
      sub: `${(kpi.pay_rate * 100).toFixed(1)}% 的用户完成了付费` },
    { label: '订单量', value: formatNumber(kpi.order_count_period),
      tip: '选定时间内已支付成功的订单数，成功率 = 已支付 ÷ 全部订单',
      sub: `${(kpi.pay_success_rate * 100).toFixed(1)}% 订单支付成功` },
    { label: '销售总额', value: formatAmountShort(kpi.gmv_period),
      tip: '选定时间内所有已支付订单的总金额，环比为与上一个同等时间段对比',
      sub: '选定时间内收款总额',
      changeRate: calcChangeRate(kpi.gmv_period, kpi.gmv_prev) },
    { label: '客单价', value: formatAmount(kpi.arpu || 0),
      tip: '销售总额 ÷ 付费用户数，反映每位付费用户的平均消费水平',
      sub: '平均每位付费用户消费' },
  ] : [];

  const compDescItems = [
    { color: '#4318FF', label: '活跃付费', desc: '最近7天有API调用，且有生效中的付费订阅' },
    { color: '#00B5D8', label: '活跃免费', desc: '最近7天有API调用，但没有付费订阅' },
    { color: '#FFB547', label: '沉默用户', desc: '7~30天前有过调用，但最近7天没有活动' },
    { color: '#FF5E7D', label: '流失用户', desc: '超过30天没有任何API调用的用户' },
  ];

  const periodFilter = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {['today', '7d', '30d'].map(p => (
        <Button key={p} theme={period === p ? 'solid' : 'borderless'} size="small"
          style={{ borderRadius: 6, fontWeight: 500 }}
          onClick={() => handlePeriodChange(p)}>
          {p === 'today' ? '今日' : p === '7d' ? '近7日' : '近30日'}
        </Button>
      ))}
      <Button theme={period === 'custom' ? 'solid' : 'borderless'} size="small"
        style={{ borderRadius: 6, fontWeight: 500 }}
        onClick={() => handlePeriodChange('custom')}>自定义</Button>
      {period === 'custom' && (
        <DatePicker type="dateRange" density="compact" style={{ width: 240, marginLeft: 4 }}
          value={customRange} onChange={handleCustomRange} />
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <ConfigPageTabs defaultActiveKey="usage" tabBarExtraContent={periodFilter}>
        <ConfigPageTabPane tab="用量" itemKey="usage">
          <Dashboard period={period} customRange={period === 'custom' ? customRange : null} />
        </ConfigPageTabPane>
        <ConfigPageTabPane tab="用户" itemKey="user">
          <Spin spinning={loading}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}>
              {userKpiItems.map((item, i) => (
                <KpiCard key={i} {...item} />
              ))}
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={24}>
                <ChartCard title={`用户增长趋势（${periodLabel}）`}
                  tip="柱状图为每日新增注册用户，折线为截至当日的累计用户总数">
                  <div ref={chartRefs.user} style={{ height: 280 }} />
                </ChartCard>
              </Col>
            </Row>

        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col span={12}>
            <ChartCard title="用户构成" tip="基于最近活跃度和付费状态，将所有用户分为四类">
              <div style={{ display: 'flex', gap: 16 }}>
                <div ref={chartRefs.comp} style={{ height: 260, flex: 1 }} />
                <div style={{ width: 200, paddingTop: 12 }}>
                  {compDescItems.map(item => (
                    <div key={item.label} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1B2559' }}>{item.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#A3AED0', lineHeight: 1.4, paddingLeft: 14 }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </ChartCard>
          </Col>
          <Col span={12}>
            <ChartCard title="转化漏斗" tip="追踪选定时间内注册的用户，从注册 → 首次调用API → 首次付费的转化情况">
              <div ref={chartRefs.funnel} style={{ height: 260 }} />
            </ChartCard>
          </Col>
        </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={24}>
                <ChartCard title={`高价值用户 TOP 10（${periodLabel}）`}
                  tip="选定时间内累计消费金额最高的用户排行，帮助识别核心付费用户">
                  <Table columns={spenderColumns}
                    dataSource={dashboardData?.top_spenders || []}
                    pagination={false} size="small" rowKey="user_id" empty={<Empty description="暂无数据" />} />
                </ChartCard>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={24}>
                <ChartCard title={`活跃用户版本分布（${periodLabel}）`}
                  tip="选定时间内有实际 API 调用的活跃用户，当前实际使用的客户端版本分布；同一用户取其最近一次上报的版本，未上报版本者归入「未知」">
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div ref={chartRefs.version} style={{ height: 260, flex: 1 }} />
                    <div style={{ width: 240, paddingTop: 12 }}>
                      {(versionDist || []).length === 0 && (
                        <div style={{ fontSize: 12, color: '#A3AED0' }}>暂无版本数据</div>
                      )}
                      {(versionDist || []).map(item => (
                        <div key={item.version} style={{
                          display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', marginBottom: 10,
                        }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1B2559' }}>
                            {item.version === '未知' ? '未知版本' : 'v' + item.version}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#4318FF' }}>
                            {formatNumber(item.users)} 人
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartCard>
              </Col>
            </Row>

            <div style={{
              fontSize: 13, fontWeight: 600, color: '#8F9BBA',
              margin: '4px 0 12px', letterSpacing: 0.5,
            }}>
              官网首页
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}>
              {homepageKpiItems.map((item, i) => (
                <KpiCard key={i} {...item} />
              ))}
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={24}>
                <ChartCard title={`安装包下载分布（${periodLabel}）`}
                  tip="选定时间内各平台下载按钮的点击次数分布（mac Apple Silicon / mac Intel / Windows）">
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div ref={chartRefs.downloadPlatform} style={{ height: 260, flex: 1 }} />
                    <div style={{ width: 240, paddingTop: 12 }}>
                      {(homepage?.platform_dist || []).length === 0 && (
                        <div style={{ fontSize: 12, color: '#A3AED0' }}>暂无下载点击数据</div>
                      )}
                      {(homepage?.platform_dist || []).map(item => (
                        <div key={item.platform} style={{
                          display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', marginBottom: 10,
                        }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1B2559' }}>
                            {PLATFORM_LABEL_MAP[item.platform] || item.platform}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#4318FF' }}>
                            {formatNumber(item.count)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartCard>
              </Col>
            </Row>

            <div style={{
              fontSize: 13, fontWeight: 600, color: '#8F9BBA',
              margin: '4px 0 4px', letterSpacing: 0.5,
            }}>
              设备与版本
            </div>
            <div style={{ fontSize: 11, color: '#A3AED0', marginBottom: 12 }}>
              统计口径：客户端埋点上报记录，按用户去重，已排除匿名（未登录）事件
              {device?.total_users != null && `，区间内 ${formatNumber(device.total_users)} 名上报用户`}
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={16}>
                <ChartCard title={`客户端版本分布（${periodLabel}）`}
                  tip="各客户端版本的去重用户数，最多展示 12 个版本，用于判断升级率与旧版本长尾">
                  <div ref={chartRefs.deviceVersion} style={{ height: 280 }} />
                  {(device?.version_dist || []).length === 0 && (
                    <Empty style={{ padding: 40 }} description="暂无上报数据" />
                  )}
                </ChartCard>
              </Col>
              <Col span={8}>
                <ChartCard title={`平台分布（${periodLabel}）`}
                  tip="活跃用户所在平台（macOS / Windows）的去重用户占比">
                  <div ref={chartRefs.devicePlatform} style={{ height: 280 }} />
                  {(device?.platform_dist || []).length === 0 && (
                    <Empty style={{ padding: 40 }} description="暂无上报数据" />
                  )}
                </ChartCard>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={16}>
                <ChartCard title={`系统版本分布（${periodLabel}）`}
                  tip="活跃用户的操作系统版本去重用户数，最多展示 12 个版本，用于决定最低支持系统">
                  <div ref={chartRefs.deviceOs} style={{ height: 280 }} />
                  {(device?.os_dist || []).length === 0 && (
                    <Empty style={{ padding: 40 }} description="暂无上报数据" />
                  )}
                </ChartCard>
              </Col>
              <Col span={8}>
                <ChartCard title={`架构分布（${periodLabel}）`}
                  tip="活跃用户设备的 CPU 架构（arm64 / x64）去重用户占比，用于评估 Intel 设备占比">
                  <div ref={chartRefs.deviceArch} style={{ height: 280 }} />
                  {(device?.arch_dist || []).length === 0 && (
                    <Empty style={{ padding: 40 }} description="暂无上报数据" />
                  )}
                </ChartCard>
              </Col>
            </Row>
          </Spin>
        </ConfigPageTabPane>

        <ConfigPageTabPane tab="营收" itemKey="revenue">
          <Spin spinning={loading}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}>
              {revenueKpiItems.map((item, i) => (
                <KpiCard key={i} {...item} />
              ))}
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={24}>
                <ChartCard title={`收入趋势（${periodLabel}）`}
                  tip="柱状图为每日收入金额（元），折线为每日成交订单数">
                  <div ref={chartRefs.revenue} style={{ height: 280 }} />
                </ChartCard>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={8}>
                <ChartCard title={`套餐销售（${periodLabel}）`} tip="选定时间内各套餐的订单数量分布">
                  <div ref={chartRefs.pkg} style={{ height: 260 }} />
                </ChartCard>
              </Col>
              <Col span={8}>
                <ChartCard title={`支付方式（${periodLabel}）`} tip="选定时间内微信/支付宝等各支付渠道的订单占比">
                  <div ref={chartRefs.payType} style={{ height: 260 }} />
                </ChartCard>
              </Col>
              <Col span={8}>
                <ChartCard title={`订单状态（${periodLabel}）`} tip="选定时间内订单的支付状态分布：已支付、待支付、已取消、已过期">
                  <div ref={chartRefs.orderStatus} style={{ height: 260 }} />
                </ChartCard>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={24}>
                <ChartCard title="最近订单" tip="平台最新的10笔订单记录，不受时间筛选影响">
                  <Table columns={orderColumns}
                    dataSource={dashboardData?.recent_orders || []}
                    pagination={false} size="small" rowKey="order_no" empty={<Empty description="暂无订单数据" />} />
                </ChartCard>
              </Col>
            </Row>
          </Spin>
        </ConfigPageTabPane>

        <ConfigPageTabPane tab="成本/利润" itemKey="cost">
          <Empty
            style={{ padding: 80 }}
            title="敬请期待"
            description="渠道真实成本、毛利率趋势、成本占比等指标即将上线"
          />
        </ConfigPageTabPane>
      </ConfigPageTabs>
    </div>
  );
};

export default ParvisDashboard;
