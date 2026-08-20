import React, { useEffect, useRef, useState } from 'react';
import { Card, Col, Row, Select, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import VChart from '@visactor/vchart';
import { API, showError } from '../../helpers';
import { EXCEPTION_EVENTS } from '../../constants/clientEvents';

const { Title, Text } = Typography;

const EVENT_LABELS = EXCEPTION_EVENTS.reduce((m, name) => {
  m[name] = name;
  return m;
}, {});

const EXCEPTION_EVENT_PARAM = encodeURIComponent(EXCEPTION_EVENTS.join(','));

const cardStyle = {
  borderRadius: 10, border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

const MonitorBoard = () => {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState([]);
  const [trend, setTrend] = useState([]);
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState('7d');
  const [eventFilter, setEventFilter] = useState('');
  const trendChartRef = useRef(null);
  const trendInstanceRef = useRef(null);

  const fetchStats = async () => {
    setLoading(true);
    try {
      let url = `/api/client-event/stats?period=${period}&event_names=${EXCEPTION_EVENT_PARAM}`;
      if (eventFilter) url += `&event_name=${encodeURIComponent(eventFilter)}`;
      const res = await API.get(url);
      if (res.data.success) {
        setStats(res.data.data.stats || []);
        setTrend(res.data.data.trend || []);
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  const fetchList = async (p = 1) => {
    try {
      let url = `/api/client-event/list?period=${period}&page=${p}&per_page=20&event_names=${EXCEPTION_EVENT_PARAM}`;
      if (eventFilter) url += `&event_name=${encodeURIComponent(eventFilter)}`;
      const res = await API.get(url);
      if (res.data.success) {
        setEvents(res.data.data.items || []);
        setTotal(res.data.data.total || 0);
        setPage(p);
      }
    } catch (e) {
      showError(e.message);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchList(1);
  }, [period, eventFilter]);

  useEffect(() => {
    if (!trendChartRef.current || trend.length === 0) return;
    if (trendInstanceRef.current) {
      trendInstanceRef.current.release();
    }
    const byDate = new Map();
    trend.forEach((t) => {
      byDate.set(t.date, (byDate.get(t.date) || 0) + t.count);
    });
    const merged = Array.from(byDate, ([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const spec = {
      type: 'line',
      data: [{ id: 'trend', values: merged }],
      xField: 'date',
      yField: 'count',
      point: { visible: true, size: 4 },
      line: { style: { lineWidth: 2 } },
      axes: [
        { orient: 'bottom', label: { style: { fontSize: 11 } } },
        { orient: 'left', label: { style: { fontSize: 11 } } },
      ],
    };
    trendInstanceRef.current = new VChart(spec, { dom: trendChartRef.current });
    trendInstanceRef.current.renderSync();
    return () => {
      if (trendInstanceRef.current) {
        trendInstanceRef.current.release();
        trendInstanceRef.current = null;
      }
    };
  }, [trend]);

  const columns = [
    { title: '时间', dataIndex: 'created_at', width: 180, render: (v) => new Date(v).toLocaleString() },
    { title: '用户', dataIndex: 'username', width: 120 },
    { title: '事件', dataIndex: 'event_name', width: 160, render: (v) => <Tag>{EVENT_LABELS[v] || v}</Tag> },
    { title: '附加数据', dataIndex: 'event_data', render: (v) => <Text copyable style={{ fontSize: 12 }}>{v || '-'}</Text> },
    { title: '版本', dataIndex: 'client_version', width: 100 },
    { title: '平台', dataIndex: 'platform', width: 80 },
    { title: '系统版本', dataIndex: 'os_version', width: 110, render: (v) => v || '-' },
    { title: '架构', dataIndex: 'arch', width: 90, render: (v) => v || '-' },
  ];

  const eventOptions = Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }));

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Select
            value={period}
            onChange={setPeriod}
            style={{ width: 120 }}
            optionList={[
              { value: 'today', label: '今天' },
              { value: '7d', label: '近7天' },
              { value: '30d', label: '近30天' },
            ]}
          />
          <Select
            value={eventFilter}
            onChange={setEventFilter}
            style={{ width: 180 }}
            placeholder="筛选异常类型"
            showClear
            optionList={eventOptions}
          />
        </div>
      </div>

      <Spin spinning={loading}>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {stats.map((s) => (
            <Col span={6} key={s.event_name} style={{ marginBottom: 12 }}>
              <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                <div style={{ fontSize: 16, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>
                  {EVENT_LABELS[s.event_name] || s.event_name}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{s.count}</div>
                <div style={{ fontSize: 12, color: '#A3AED0', marginTop: 4 }}>
                  独立用户: {s.unique_users}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        <Card style={{ ...cardStyle, marginBottom: 24 }} bodyStyle={{ padding: 16 }}>
          <Title heading={6} style={{ marginBottom: 12 }}>事件趋势</Title>
          <div ref={trendChartRef} style={{ width: '100%', height: 260 }} />
        </Card>

        <Card style={cardStyle} bodyStyle={{ padding: 0 }}>
          <Table
            columns={columns}
            dataSource={events}
            pagination={{
              currentPage: page,
              pageSize: 20,
              total,
              onPageChange: fetchList,
            }}
            rowKey="id"
            size="small"
          />
        </Card>
      </Spin>
    </div>
  );
};

export default MonitorBoard;
