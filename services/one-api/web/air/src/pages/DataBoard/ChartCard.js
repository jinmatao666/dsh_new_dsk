import React, { useEffect, useRef, useState } from 'react';
import { Card, Empty, RadioGroup, Radio, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { Trash2 } from 'lucide-react';
import VChart from '@visactor/vchart';

const { Text } = Typography;

const cardStyle = {
  borderRadius: 10,
  border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

export const PERIOD_LABELS = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
};

export const CHART_TYPE_LABELS = {
  line: '折线图',
  bar: '柱状图',
  pie: '饼图',
  funnel: '漏斗图',
  table: '表格',
};

export const VALUE_MODE_LABELS = {
  pv: '次数(PV)',
  uv: '独立用户(UV)',
};

// PV 用 count，UV 用 unique_users；细分/普通统计的字段名一致。
const valueFieldFor = (mode) => (mode === 'uv' ? 'unique_users' : 'count');

const formatStatsForChart = (stats, valueField) =>
  (stats || []).map((s) => ({ event: s.event_name, value: s[valueField] || 0 }));

const formatTrendForChart = (trend, valueField) =>
  (trend || []).map((t) => ({
    date: t.date,
    event: t.event_name || '全部',
    value: t[valueField] || 0,
  }));

// 漏斗数据：取数侧已按层顺序组装好 stats（每行 event_name 为层展示名，含 count/unique_users），
// 这里直接按返回顺序映射，无需重排。每层附带 ratioFirst（相对首层）与 ratioPrev（相对上一层）转化率。
const formatFunnelForChart = (stats, valueField) => {
  const layers = (stats || []).map((s) => ({ name: s.event_name, value: s[valueField] || 0 }));
  const first = layers[0]?.value || 0;
  return layers.map((l, i) => {
    const prev = i === 0 ? l.value : layers[i - 1].value;
    return {
      name: l.name,
      value: l.value,
      ratioFirst: first > 0 ? l.value / first : 0,
      ratioPrev: prev > 0 ? l.value / prev : 0,
    };
  });
};

const pct = (v) => `${(v * 100).toFixed(1)}%`;

const buildSpec = (chartType, data) => {
  if (!data || data.length === 0) return null;
  if (chartType === 'funnel') {
    // funnel 数据每行 {name, value, ratioFirst, ratioPrev}。
    // isTransform 打开时 VChart 会额外渲染层间转化的过渡块。
    // 标签展示：层名 + 分量；转化率（相对上一层）作为过渡块标签。
    return {
      type: 'funnel',
      data: [{ id: 'funnel', values: data }],
      categoryField: 'name',
      valueField: 'value',
      isTransform: true,
      funnelAlign: 'center',
      shape: 'trapezoid',
      label: {
        visible: true,
        formatMethod: (t, datum) => `${datum?.name}: ${datum?.value}`,
        style: { fontSize: 11 },
      },
      transformLabel: {
        visible: true,
        formatMethod: (t, datum) => (datum ? `转化 ${pct(datum.ratioPrev)}` : ''),
        style: { fontSize: 10, fill: '#8F9BBA' },
      },
      outerLabel: {
        visible: true,
        position: 'right',
        formatMethod: (t, datum) => (datum ? `占首层 ${pct(datum.ratioFirst)}` : ''),
        style: { fontSize: 10, fill: '#8F9BBA' },
      },
      legends: { visible: false },
    };
  }
  const xField = data[0] && 'date' in data[0] ? 'date' : 'event';
  // 趋势数据按事件分多系列；次数数据本身每行即一个事件
  const isTrend = xField === 'date';
  const seriesField = isTrend ? 'event' : undefined;
  if (chartType === 'pie') {
    return {
      type: 'pie',
      data: [{ id: 'src', values: data }],
      categoryField: xField,
      valueField: 'value',
      outerRadius: 0.85,
      innerRadius: 0.55,
      label: { visible: true, style: { fontSize: 11 } },
      legends: { visible: true, orient: 'right', position: 'middle' },
    };
  }
  if (chartType === 'bar') {
    return {
      type: 'bar',
      data: [{ id: 'src', values: data }],
      xField: seriesField ? [xField, seriesField] : xField,
      yField: 'value',
      ...(seriesField ? { seriesField } : {}),
      bar: { style: { cornerRadius: [4, 4, 0, 0] } },
      legends: seriesField ? { visible: true, orient: 'top' } : undefined,
      axes: [
        { orient: 'bottom', label: { style: { fontSize: 11 } } },
        { orient: 'left', label: { style: { fontSize: 11 } } },
      ],
    };
  }
  return {
    type: 'line',
    data: [{ id: 'src', values: data }],
    xField,
    yField: 'value',
    ...(seriesField ? { seriesField } : {}),
    point: { visible: true, size: 4 },
    line: { style: { lineWidth: 2 } },
    legends: seriesField ? { visible: true, orient: 'top' } : undefined,
    axes: [
      { orient: 'bottom', label: { style: { fontSize: 11 } } },
      { orient: 'left', label: { style: { fontSize: 11 } } },
    ],
  };
};

const renderTable = (chart, stats, list, valueMode) => {
  if (chart.metric === 'list') {
    const columns = [
      { title: '时间', dataIndex: 'created_at', width: 170, render: (v) => new Date(v).toLocaleString() },
      { title: '用户', dataIndex: 'username', width: 120 },
      { title: '事件', dataIndex: 'event_name', width: 160, render: (v) => <Tag>{v}</Tag> },
      { title: '附加数据', dataIndex: 'event_data', render: (v) => <Text style={{ fontSize: 12 }} ellipsis={{ showTooltip: true }}>{v || '-'}</Text> },
    ];
    return <Table columns={columns} dataSource={list || []} pagination={false} rowKey="id" size="small" />;
  }
  const valueField = valueFieldFor(valueMode);
  const columns = [
    { title: chart.subdivide ? chart.subdivide : '事件', dataIndex: 'event_name', render: (v) => <Tag>{v}</Tag> },
    {
      title: VALUE_MODE_LABELS[valueMode] || '次数',
      dataIndex: valueField,
      width: 140,
      render: (v, r) => (r[valueField] ?? 0),
    },
  ];
  return <Table columns={columns} dataSource={stats || []} pagination={false} rowKey="event_name" size="small" />;
};

const ChartCard = ({ chart, data, loading, onRemove, readOnly }) => {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  // UV/PV 为卡片本地展示状态，初值取 config，切换不触发重新拉数（后端已同时返回两值）。
  const [valueMode, setValueMode] = useState(chart.valueMode === 'uv' ? 'uv' : 'pv');
  const isVisualChart = chart.chartType !== 'table';
  const isFunnel = chart.chartType === 'funnel';
  // 漏斗为用户维度逐层求交,只用 UV;其余计数图表可 PV/UV 切换。列表无计数。
  const isCountable = chart.metric !== 'list' && !isFunnel;
  const valueField = isFunnel ? 'unique_users' : valueFieldFor(valueMode);
  const sourceData =
    isFunnel
      ? formatFunnelForChart(data?.stats, valueField)
      : chart.metric === 'trend'
        ? formatTrendForChart(data?.trend, valueField)
        : formatStatsForChart(data?.stats, valueField);

  useEffect(() => {
    if (!isVisualChart || !chartRef.current) return;
    if (instanceRef.current) {
      instanceRef.current.release();
      instanceRef.current = null;
    }
    const spec = buildSpec(chart.chartType, sourceData);
    if (!spec) return;
    instanceRef.current = new VChart(spec, { dom: chartRef.current });
    instanceRef.current.renderSync();
    return () => {
      if (instanceRef.current) {
        instanceRef.current.release();
        instanceRef.current = null;
      }
    };
  }, [isVisualChart, chart.chartType, chart.metric, JSON.stringify(sourceData)]);

  const eventLabel =
    chart.eventNames && chart.eventNames.length > 0
      ? chart.eventNames.join('、')
      : '全部事件';

  return (
    <Card
      style={cardStyle}
      bodyStyle={{ padding: 16 }}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text strong style={{ fontSize: 14 }}>{chart.title}</Text>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag size="small" color="blue">{PERIOD_LABELS[chart.period] || chart.period}</Tag>
            <Tag size="small" color="violet">{CHART_TYPE_LABELS[chart.chartType] || chart.chartType}</Tag>
            {chart.subdivide && <Tag size="small" color="cyan">细分: {chart.subdivide}</Tag>}
            <Tag size="small" color="grey" style={{ maxWidth: 240 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%', verticalAlign: 'middle' }}>
                {eventLabel}
              </span>
            </Tag>
          </div>
        </div>
      }
      headerExtraContent={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isCountable && (
            <RadioGroup
              type="button"
              buttonSize="small"
              value={valueMode}
              onChange={(e) => setValueMode(e.target.value)}
            >
              <Radio value="pv">PV</Radio>
              <Radio value="uv">UV</Radio>
            </RadioGroup>
          )}
          {!readOnly && (
            <Trash2
              size={15}
              strokeWidth={1.75}
              style={{ cursor: 'pointer', color: '#8F9BBA' }}
              onClick={() => onRemove(chart.id)}
            />
          )}
        </div>
      }
    >
      <Spin spinning={loading}>
        {isVisualChart ? (
          chart.chartType === 'funnel' && sourceData.length < 2 ? (
            <Empty description="漏斗图需选择至少 2 个事件作为层级" style={{ padding: 32 }} />
          ) : sourceData.length === 0 ? (
            <Empty description="无数据" style={{ padding: 32 }} />
          ) : (
            <div ref={chartRef} style={{ width: '100%', height: 260 }} />
          )
        ) : (
          renderTable(chart, data?.stats, data?.list, valueMode)
        )}
      </Spin>
    </Card>
  );
};

export default ChartCard;
