import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Col, Empty, Row, Select, Spin, Table, Tabs, TabPane } from '@douyinfe/semi-ui';
import VChart from '@visactor/vchart';
import { API, isAdmin, showError } from '../../helpers';
import { renderNumber, renderQuota } from '../../helpers/render';

const cardStyle = {
  borderRadius: 10, border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};
const headerStyle = { padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' };
const bodyStyle = { padding: '12px 16px 16px' };

const KpiBox = ({ label, value, chartRef }) => (
  <Card bodyStyle={{ padding: '18px 20px' }} style={cardStyle}>
    <div style={{ fontSize: 16, color: '#8F9BBA', fontWeight: 500, marginBottom: 8, letterSpacing: 0.5 }}>
      {label}
    </div>
    <div style={{ fontSize: 28, fontWeight: 700, color: '#1B2559', lineHeight: 1.1,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
      marginBottom: 6 }}>
      {value}
    </div>
    <div ref={chartRef} style={{ height: 110 }} />
  </Card>
);

const Dashboard = ({ period = '7d', customRange = null }) => {
  const isAdminUser = isAdmin();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [channelData, setChannelData] = useState([]);
  const [usageDim, setUsageDim] = useState('model'); // model | channel
  const [xAxisGranularity, setXAxisGranularity] = useState(period === 'today' ? 'hour' : 'day');
  const [summaryData, setSummaryData] = useState({
    todayRequests: 0, todayQuota: 0, todayTokens: 0,
  });

  const periodLabel = period === 'today' ? '今日'
    : period === '30d' ? '近30日'
    : period === 'custom'
      ? (customRange && customRange.length === 2
        ? `${new Date(customRange[0]).toLocaleDateString('zh-CN')} ~ ${new Date(customRange[1]).toLocaleDateString('zh-CN')}`
        : '自定义')
      : '近7日';

  const [filterUsername, setFilterUsername] = useState('');
  const [filterInput, setFilterInput] = useState('');

  const [rankingSort, setRankingSort] = useState('tokens');
  const [rankingData, setRankingData] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const requestChartRef = useRef(null);
  const quotaChartRef = useRef(null);
  const tokenChartRef = useRef(null);
  const modelChartRef = useRef(null);
  const channelChartRef = useRef(null);
  const chartInstances = useRef({});

  const getTimestampRange = () => {
    const now = new Date();
    if (period === 'custom' && customRange && customRange.length === 2) {
      const s = new Date(customRange[0]); s.setHours(0, 0, 0, 0);
      const e = new Date(customRange[1]); e.setHours(23, 59, 59, 999);
      return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) };
    }
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const start = new Date(end);
    if (period === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (period === '30d') {
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    }
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
  };

  const isHourly = xAxisGranularity === 'hour';

  const fetchDashboardData = async (username) => {
    setLoading(true);
    try {
      const { start, end } = getTimestampRange();
      const u = username !== undefined ? username : filterUsername;
      let qs = `start_timestamp=${start}&end_timestamp=${end}`;
      if (xAxisGranularity === 'hour') qs += '&granularity=hour';
      if (u) qs += `&username=${encodeURIComponent(u)}`;
      const res = await API.get(`/api/user/dashboard?${qs}`);
      const { success, message, data: d } = res.data;
      if (success) {
        setData(d || []);
        calculateSummary(d || []);
      } else {
        showError(message);
      }
    } catch { showError('获取数据失败'); }
    setLoading(false);
  };

  const fetchChannelData = async (username) => {
    try {
      const { start, end } = getTimestampRange();
      const u = username !== undefined ? username : filterUsername;
      let qs = `start_timestamp=${start}&end_timestamp=${end}`;
      if (xAxisGranularity === 'hour') qs += '&granularity=hour';
      if (u) qs += `&username=${encodeURIComponent(u)}`;
      const res = await API.get(`/api/user/dashboard/channel?${qs}`);
      const { success, data: d } = res.data;
      if (success) setChannelData(d || []);
    } catch { /* 渠道维度失败不阻塞主图，静默降级 */ }
  };

  const rankingRange = period === 'custom' ? '30d' : period;

  const fetchRanking = async () => {
    if (!isAdminUser) return;
    setRankingLoading(true);
    try {
      const res = await API.get(`/api/log/ranking?range=${rankingRange}&sort=${rankingSort}&limit=20`);
      const { success, data: d, message } = res.data;
      if (success) setRankingData(d || []);
      else showError(message);
    } catch { showError('获取排行榜失败'); }
    setRankingLoading(false);
  };

  useEffect(() => {
    fetchDashboardData();
    fetchChannelData();
    return () => Object.values(chartInstances.current).forEach(c => c?.release());
  }, []);

  useEffect(() => {
    setXAxisGranularity(period === 'today' ? 'hour' : 'day');
  }, [period]);

  useEffect(() => { fetchDashboardData(); fetchChannelData(); }, [filterUsername, period, customRange, xAxisGranularity]);

  useEffect(() => {
    const t = setTimeout(() => setFilterUsername(filterInput.trim()), 400);
    return () => clearTimeout(t);
  }, [filterInput]);

  useEffect(() => { fetchRanking(); }, [rankingRange, rankingSort]);

  useEffect(() => {
    renderCharts(data);
  }, [data, period, customRange, xAxisGranularity]);

  useEffect(() => {
    if (usageDim === 'channel') {
      setTimeout(() => mkChannel(channelData, getDateRange()), 60);
    } else {
      setTimeout(() => mkModel(filterByRange(data), getDateRange()), 60);
    }
  }, [usageDim, channelData, data, period, customRange, xAxisGranularity]);

  const filterByRange = (dashboardData) => {
    const dateSet = new Set(getDateRange());
    return dashboardData.filter(i => dateSet.has(i.Day));
  };

  const calculateSummary = (d) => {
    if (!Array.isArray(d) || d.length === 0) {
      setSummaryData({ todayRequests: 0, todayQuota: 0, todayTokens: 0 });
      return;
    }
    setSummaryData({
      todayRequests: d.reduce((s, i) => s + i.RequestCount, 0),
      todayQuota: d.reduce((s, i) => s + i.Quota, 0),
      todayTokens: d.reduce((s, i) => s + i.PromptTokens + i.CompletionTokens, 0),
    });
  };

  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtHourKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`;
  const formatBucketLabel = (bucket) => {
    if (!isHourly) return bucket.slice(5);
    return period === 'today' ? bucket.slice(11) : bucket.slice(5);
  };

  const getDateRange = () => {
    const allDates = [];
    const { start, end } = getTimestampRange();
    const startD = new Date(start * 1000), endD = new Date(end * 1000);
    if (isHourly) {
      const cur = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), 0, 0, 0);
      const last = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate(), 23, 0, 0);
      while (cur <= last) {
        allDates.push(fmtHourKey(cur));
        cur.setHours(cur.getHours() + 1);
      }
      return allDates;
    }
    for (let d = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate()); d <= endD; d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }
    return allDates;
  };

  const renderCharts = (dashboardData) => {
    const allDates = getDateRange();
    const dateSet = new Set(allDates);
    const filtered = dashboardData.filter(i => dateSet.has(i.Day));
    const qpu = parseFloat(localStorage.getItem('quota_per_unit') || '1000');

    const dm = {};
    allDates.forEach(d => { dm[d] = { requests: 0, quota: 0, tokens: 0 }; });
    filtered.forEach(i => {
      if (dm[i.Day]) {
        dm[i.Day].requests += i.RequestCount;
        dm[i.Day].quota += i.Quota / qpu;
        dm[i.Day].tokens += i.PromptTokens + i.CompletionTokens;
      }
    });
    const lineData = allDates.map(d => ({
      date: formatBucketLabel(d),
      requests: dm[d].requests,
      quota: parseFloat(dm[d].quota.toFixed(2)), tokens: dm[d].tokens,
    }));

    setTimeout(() => {
      mkLine(requestChartRef, 'req', lineData, 'requests', '请求量', '#4318FF');
      mkLine(quotaChartRef, 'quota', lineData, 'quota', '消费(积分)', '#00B5D8');
      mkLine(tokenChartRef, 'token', lineData, 'tokens', 'Token', '#6C63FF');
    }, 100);
  };

  const mkLine = (ref, key, data, field, label, color) => {
    if (!ref.current) return;
    chartInstances.current[key]?.release();
    const c = new VChart({
      type: 'line', data: [{ values: data }], xField: 'date', yField: field,
      line: { style: { stroke: color, lineWidth: 2 } }, point: { visible: false },
      axes: [
        { orient: 'bottom', label: { style: { fontSize: 12, fill: '#A3AED0' } } },
        { orient: 'left', label: { style: { fontSize: 12, fill: '#A3AED0' } } },
      ],
      tooltip: { mark: { content: [{ key: label, value: d => d[field] }] } },
    }, { dom: ref.current });
    c.renderSync();
    chartInstances.current[key] = c;
  };

  const mkModel = (dashboardData, allDates) => {
    if (!modelChartRef.current) return;
    chartInstances.current.model?.release();
    const models = [...new Set(dashboardData.map(i => i.ModelName))];
    const cd = [];
    allDates.forEach(date => {
      models.forEach(model => {
        const items = dashboardData.filter(d => d.Day === date && d.ModelName === model);
        cd.push({
          date: formatBucketLabel(date),
          model,
          tokens: items.reduce((s, d) => s + d.PromptTokens + d.CompletionTokens, 0),
        });
      });
    });
    const c = new VChart({
      type: 'bar', data: [{ values: cd }], xField: 'date', yField: 'tokens',
      seriesField: 'model', stack: true,
      bar: { style: { cornerRadius: [2, 2, 0, 0] } },
      axes: [
        { orient: 'bottom', label: { style: { fontSize: 12, fill: '#A3AED0' } } },
        { orient: 'left', label: { style: { fontSize: 12, fill: '#A3AED0' } } },
      ],
      legends: { visible: true, orient: 'bottom' },
    }, { dom: modelChartRef.current });
    c.renderSync();
    chartInstances.current.model = c;
  };

  const mkChannel = (rows, allDates) => {
    if (!channelChartRef.current) return;
    chartInstances.current.channel?.release();
    const dateSet = new Set(allDates);
    const filtered = (rows || []).filter(i => dateSet.has(i.Day));
    const channels = [...new Set(filtered.map(i => i.ChannelName))];
    const cd = [];
    allDates.forEach(date => {
      channels.forEach(channel => {
        const items = filtered.filter(d => d.Day === date && d.ChannelName === channel);
        cd.push({
          date: formatBucketLabel(date),
          channel,
          tokens: items.reduce((s, d) => s + d.PromptTokens + d.CompletionTokens, 0),
        });
      });
    });
    const c = new VChart({
      type: 'bar', data: [{ values: cd }], xField: 'date', yField: 'tokens',
      seriesField: 'channel', stack: true,
      bar: { style: { cornerRadius: [2, 2, 0, 0] } },
      axes: [
        { orient: 'bottom', label: { style: { fontSize: 12, fill: '#A3AED0' } } },
        { orient: 'left', label: { style: { fontSize: 12, fill: '#A3AED0' } } },
      ],
      legends: { visible: true, orient: 'bottom' },
    }, { dom: channelChartRef.current });
    c.renderSync();
    chartInstances.current.channel = c;
  };

  return (
    <>
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col span={8}>
            <KpiBox label={`请求次数（${periodLabel}）`} value={renderNumber(summaryData.todayRequests)} chartRef={requestChartRef} />
          </Col>
          <Col span={8}>
            <KpiBox label={`积分消费（${periodLabel}）`} value={renderQuota(summaryData.todayQuota)} chartRef={quotaChartRef} />
          </Col>
          <Col span={8}>
            <KpiBox label={`token消费（${periodLabel}）`} value={renderNumber(summaryData.todayTokens)} chartRef={tokenChartRef} />
          </Col>
        </Row>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={24}>
            <Card
              title={usageDim === 'model' ? '模型 Token 使用分布' : '渠道 Token 使用分布'}
              headerStyle={headerStyle}
              bodyStyle={bodyStyle}
              style={cardStyle}
              headerExtraContent={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Select
                    size="small"
                    value={xAxisGranularity}
                    onChange={setXAxisGranularity}
                    optionList={[
                      { value: 'hour', label: 'X轴: 按小时' },
                      { value: 'day', label: 'X轴: 按天' },
                    ]}
                    style={{ width: 118 }}
                  />
                  <Button theme={usageDim === 'model' ? 'solid' : 'borderless'} size="small"
                    style={{ borderRadius: 6, fontWeight: 500 }}
                    onClick={() => setUsageDim('model')}>按模型</Button>
                  <Button theme={usageDim === 'channel' ? 'solid' : 'borderless'} size="small"
                    style={{ borderRadius: 6, fontWeight: 500 }}
                    onClick={() => setUsageDim('channel')}>按渠道</Button>
                </div>
              }
            >
              <div ref={modelChartRef} style={{ height: 350, display: usageDim === 'model' ? 'block' : 'none' }} />
              <div ref={channelChartRef} style={{ height: 350, display: usageDim === 'channel' ? 'block' : 'none' }} />
              {usageDim === 'channel' && channelData.length === 0 && (
                <Empty style={{ padding: 40 }} description="暂无渠道用量数据" />
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
      {isAdminUser && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={24}>
            <Card
              title="用户用量排行榜"
              headerStyle={headerStyle}
              bodyStyle={bodyStyle}
              style={cardStyle}
            >
              <Tabs activeKey={rankingSort} onChange={setRankingSort} type="line">
                <TabPane tab="按 Token" itemKey="tokens" />
                <TabPane tab="按消费(积分)" itemKey="quota" />
                <TabPane tab="按请求数" itemKey="count" />
              </Tabs>
              <Spin spinning={rankingLoading}>
                <Table
                  dataSource={rankingData}
                  pagination={false}
                  rowKey="user_id"
                  empty={<Empty description="暂无数据" />}
                  onRow={row => ({ onClick: () => setFilterInput(row.username), style: { cursor: 'pointer' } })}
                  columns={[
                    { title: '排名', width: 70, render: (_, __, idx) => idx + 1 },
                    { title: '用户名', dataIndex: 'username' },
                    { title: 'Token', dataIndex: 'tokens', render: v => renderNumber(v) },
                    { title: '消费(积分)', dataIndex: 'quota', render: v => renderQuota(v) },
                    { title: '请求数', dataIndex: 'request_count', render: v => renderNumber(v) },
                  ]}
                />
              </Spin>
            </Card>
          </Col>
        </Row>
      )}
    </>
  );
};

export default Dashboard;
