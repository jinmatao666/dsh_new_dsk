import React, { useEffect, useMemo, useState } from 'react';
import { API, copy, isAdmin, showError, showSuccess, timestamp2string } from '../helpers';

import { Button, DatePicker, Input, Modal, Space, Table, Tag } from '@douyinfe/semi-ui';
import { Database } from 'lucide-react';
import { ITEMS_PER_PAGE } from '../constants';
import { renderNumber, renderQuota, stringToColor } from '../helpers/render';
import Paragraph from '@douyinfe/semi-ui/lib/es/typography/paragraph';
import useTableScrollY from '../hooks/useTableScrollY';
import useColumnConfig from '../hooks/useColumnConfig';

const colors = ['amber', 'blue', 'cyan', 'green', 'grey', 'indigo', 'light-blue', 'lime', 'orange', 'pink', 'purple', 'red', 'teal', 'violet', 'yellow'];

// 与后端 model/log.go 的 LogType* 常量对齐（0=未知 … 7=行为）
const TYPE_OPTIONS = [
  { value: 0, label: '未知', color: 'grey' },
  { value: 1, label: '充值', color: 'cyan' },
  { value: 2, label: '消费', color: 'lime' },
  { value: 3, label: '管理', color: 'orange' },
  { value: 4, label: '系统', color: 'purple' },
  { value: 5, label: '测试', color: 'blue' },
  { value: 6, label: '错误', color: 'red' },
  { value: 7, label: '行为', color: 'teal' },
];

function renderType(type) {
  const opt = TYPE_OPTIONS.find((o) => o.value === type);
  if (!opt) return <Tag color="grey" size="large">未知</Tag>;
  return <Tag color={opt.color} size="large"> {opt.label} </Tag>;
}

// renderTimingMs: <1s 绿，1~3s 黄，>=3s 红，0/空 → '-'
function renderTimingMs(ms) {
  const value = parseInt(ms);
  if (!ms || Number.isNaN(value) || value <= 0) {
    return <span style={{ color: '#999' }}>-</span>;
  }
  let color = '#34C759';
  if (value >= 3000) color = '#FF3B30';
  else if (value >= 1000) color = '#FF9F0A';
  return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{value} ms</span>;
}

function renderTimingStatus(record) {
  if (!record) return <span style={{ color: '#999' }}>-</span>;
  const status = record.timing_status;
  const slow = record.slow_reason;
  if (status === 'error') return <Tag color="red" size="large">错误</Tag>;
  if (slow === 'first_chunk') return <Tag color="yellow" size="large">首包慢</Tag>;
  if (slow === 'total') return <Tag color="yellow" size="large">总耗时慢</Tag>;
  if (status === 'ok') return <Tag color="green" size="large">正常</Tag>;
  return <span style={{ color: '#999' }}>-</span>;
}

// 缓存命中率 = cache_read_tokens / prompt_tokens。
// prompt_tokens 为 0（无提示 token）时无意义，返回 '-'。
// 命中率越高说明 prompt cache 复用越充分（节省成本）。
function renderCacheHitRate(record) {
  if (!record || (record.type !== 0 && record.type !== 2)) {
    return <span style={{ color: '#999' }}>-</span>;
  }
  const prompt = parseInt(record.prompt_tokens) || 0;
  const read = parseInt(record.cache_read_tokens) || 0;
  if (prompt <= 0) return <span style={{ color: '#999' }}>-</span>;
  const rate = Math.min(read / prompt, 1);
  const pct = (rate * 100).toFixed(1);
  // 命中率越高越绿：>=70% 绿，>=30% 黄，其余灰
  let color = '#8E8E93';
  if (rate >= 0.7) color = '#34C759';
  else if (rate >= 0.3) color = '#FF9F0A';
  return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>;
}

const TIMING_NUMERIC_FIELDS = [
  'select_ms',
  'upstream_request_start_ms',
  'upstream_header_ms',
  'first_chunk_ms',
  'first_write_ms',
  'upstream_wait_ms',
  'write_gap_ms',
  'elapsed_time',
];

function fmtMs(v) {
  const n = parseInt(v);
  if (!v || Number.isNaN(n) || n <= 0) return '-';
  return `${n} ms`;
}

function fmtMsRaw(v) {
  const n = parseInt(v);
  if (!v || Number.isNaN(n) || n <= 0) return null;
  return n;
}

function hasAnyTiming(record) {
  if (!record) return false;
  for (const f of TIMING_NUMERIC_FIELDS) {
    const n = parseInt(record[f]);
    if (record[f] && !Number.isNaN(n) && n > 0) return true;
  }
  if (record.request_id) return true;
  if (record.timing_status) return true;
  if (record.timing_status_code) return true;
  if (record.slow_reason) return true;
  if (record.timing_error) return true;
  if (record.upstream_request_id) return true;
  if (parseInt(record.retry_count) > 0) return true;
  return false;
}

function fmtSlowReason(s) {
  if (s === 'first_chunk') return 'first_chunk（首包慢）';
  if (s === 'total') return 'total（总耗时慢）';
  return s || '-';
}

function fmtTimingStatus(s) {
  if (!s) return '-';
  return s;
}

// 可配置显示的列（按展示顺序）。adminOnly 的列仅管理员可见。
// always 为 true 的列固定显示、不可取消（如操作列）。
const COLUMN_META = [
  { key: 'timestamp2string', label: '时间' },
  { key: 'channel', label: '渠道', adminOnly: true },
  { key: 'username', label: '用户', adminOnly: true },
  { key: 'token_name', label: '令牌' },
  { key: 'type', label: '类型' },
  { key: 'model_name', label: '模型' },
  { key: 'prompt_tokens', label: '提示' },
  { key: 'completion_tokens', label: '补全' },
  { key: 'cache_read_tokens', label: '缓存读' },
  { key: 'cache_write_tokens', label: '缓存写' },
  { key: 'cache_hit_rate', label: '命中率' },
  { key: 'quota', label: '花费' },
  { key: 'first_chunk_ms', label: '首响应' },
  { key: 'elapsed_time', label: '总耗时' },
  { key: 'timing_status', label: '状态' },
  { key: 'content', label: '详情' },
  { key: 'detail_action', label: '操作', always: true },
];

const COLUMN_STORAGE_KEY = 'logs_table_visible_columns';

const LogsTable = () => {
  const isAdminUser = isAdmin();
  // 表格滚动区自适应高度（扣除表头约 56 + 分页约 64）
  const [tableWrapRef, scrollY] = useTableScrollY({ reserve: 120 });
  const now = new Date();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activePage, setActivePage] = useState(1);
  const [logCount, setLogCount] = useState(ITEMS_PER_PAGE);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);

  // 时间区间：使用单一 dateTimeRange 控件
  const [timeRange, setTimeRange] = useState([
    new Date(now.getTime() - 86400 * 1000),
    new Date(now.getTime() + 3600 * 1000),
  ]);
  // 用户名搜索（admin 才显示）
  const [usernameKeyword, setUsernameKeyword] = useState('');

  // 列头筛选状态
  const [filters, setFilters] = useState({
    types: [],          // 类型多选；空数组=全部
    model: '',          // 模型名（精确）
    status: '',         // timing_status 或派生 slow_reason
    channel: '',        // 渠道 id
  });
  // 列头排序状态
  const [sorter, setSorter] = useState({ field: '', order: '' });

  // 表头筛选下拉的全量可选项（按时间区间从后端聚合，而非仅当前页数据）
  const [optionData, setOptionData] = useState({ models: [], channels: [] });

  const formatLogs = (rows) => {
    for (let i = 0; i < rows.length; i++) {
      rows[i].timestamp2string = timestamp2string(rows[i].created_at);
      rows[i].key = '' + rows[i].id;
    }
    setLogs(rows);
    setLogCount(rows.length + ITEMS_PER_PAGE);
  };

  const buildQuery = (startIdx, size) => {
    const start = timeRange?.[0] ? Math.floor(timeRange[0].getTime() / 1000) : 0;
    const end = timeRange?.[1] ? Math.floor(timeRange[1].getTime() / 1000) : 0;
    const params = new URLSearchParams();
    params.set('p', String(startIdx));
    params.set('page_size', String(size));
    if (filters.types?.length) params.set('types', filters.types.join(','));
    if (filters.model) params.set('model_name', filters.model);
    if (filters.channel) params.set('channel', String(filters.channel));
    if (start) params.set('start_timestamp', String(start));
    if (end) params.set('end_timestamp', String(end));
    if (isAdminUser && usernameKeyword.trim()) {
      params.set('username', usernameKeyword.trim());
    }
    // status 同时可能是 timing_status 或 slow_reason
    if (filters.status === 'ok' || filters.status === 'error') {
      params.set('timing_status', filters.status);
    } else if (filters.status === 'first_chunk' || filters.status === 'total') {
      params.set('slow_reason', filters.status);
    }
    if (sorter.field && sorter.order) {
      params.set('sort_field', sorter.field);
      params.set('sort_order', sorter.order);
    }
    return params.toString();
  };

  const loadLogs = async (startIdx, size) => {
    setLoading(true);
    const path = isAdminUser ? '/api/log/' : '/api/log/self/';
    try {
      const res = await API.get(`${path}?${buildQuery(startIdx, size)}`);
      const { success, message, data } = res.data;
      if (success) {
        if (startIdx === 0) {
          formatLogs(data);
        } else {
          const merged = [...logs];
          merged.splice(startIdx * size, data.length, ...data);
          formatLogs(merged);
        }
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e?.message || '加载日志失败');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setActivePage(1);
    await loadLogs(0, pageSize);
  };

  // 拉取表头筛选的全量可选项（模型/渠道），范围与当前时间区间一致
  const loadFilterOptions = async () => {
    const path = isAdminUser ? '/api/log/options' : '/api/log/self/options';
    const start = timeRange?.[0] ? Math.floor(timeRange[0].getTime() / 1000) : 0;
    const end = timeRange?.[1] ? Math.floor(timeRange[1].getTime() / 1000) : 0;
    const params = new URLSearchParams();
    if (start) params.set('start_timestamp', String(start));
    if (end) params.set('end_timestamp', String(end));
    try {
      const res = await API.get(`${path}?${params.toString()}`);
      const { success, data } = res.data;
      if (success && data) {
        setOptionData({
          models: Array.isArray(data.models) ? data.models : [],
          channels: Array.isArray(data.channels) ? data.channels : [],
        });
      }
    } catch (e) {
      // 选项加载失败不阻塞列表，静默降级到空选项
    }
  };

  const showUserInfo = async (userId) => {
    if (!isAdminUser) return;
    const res = await API.get(`/api/user/${userId}`);
    const { success, message, data } = res.data;
    if (success) {
      Modal.info({
        title: '用户信息',
        content: (
          <div style={{ padding: 12 }}>
            <p>用户名: {data.username}</p>
            <p>余额: {renderQuota(data.quota)}</p>
            <p>已用额度：{renderQuota(data.used_quota)}</p>
            <p>请求次数：{renderNumber(data.request_count)}</p>
          </div>
        ),
        centered: true,
      });
    } else {
      showError(message);
    }
  };

  const copyText = async (text) => {
    if (await copy(text)) {
      showSuccess('已复制：' + text);
    } else {
      Modal.error({ title: '无法复制到剪贴板，请手动复制', content: text });
    }
  };

  // 详情弹窗：基础信息 + timing 区块
  const showLogDetail = (record) => {
    const r = record || {};
    const labelStyle = { display: 'inline-block', width: 110, color: '#666' };
    const rowStyle = { marginBottom: 4, fontVariantNumeric: 'tabular-nums' };
    const sectionTitle = {
      marginTop: 16,
      marginBottom: 8,
      fontWeight: 600,
      color: '#1d1d1f',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      paddingBottom: 4,
    };

    const upstreamWait = fmtMsRaw(r.upstream_wait_ms);
    const writeGap = fmtMsRaw(r.write_gap_ms);
    const timingExists = hasAnyTiming(r);

    const content = (
      <div style={{ padding: '4px 8px', fontSize: 13, lineHeight: 1.6 }}>
        <div style={sectionTitle}>基础信息</div>
        <div style={rowStyle}>
          <span style={labelStyle}>时间:</span>
          {timestamp2string(r.created_at)}
        </div>
        {isAdminUser && (
          <div style={rowStyle}>
            <span style={labelStyle}>用户:</span>
            {r.username || '-'}
          </div>
        )}
        <div style={rowStyle}>
          <span style={labelStyle}>模型:</span>
          {r.model_name || '-'}
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>渠道:</span>
          {r.channel || '-'}
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>令牌:</span>
          {r.token_name || '-'}
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>提示 token:</span>
          {r.prompt_tokens || 0}
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>补全 token:</span>
          {r.completion_tokens || 0}
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>
            <Database size={12} style={{ verticalAlign: '-1px', marginRight: 4, color: '#8E8E93' }} />
            缓存读 token:
          </span>
          {r.cache_read_tokens || 0}
          <span style={{ color: '#666', marginLeft: 8 }}>
            (命中率 {renderCacheHitRate(r)})
          </span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>缓存写 token:</span>
          {r.cache_write_tokens || 0}
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Quota:</span>
          {renderQuota(r.quota || 0, 6)}
        </div>
        {r.content && (
          <div style={rowStyle}>
            <span style={labelStyle}>内容:</span>
            <span style={{ wordBreak: 'break-all' }}>{r.content}</span>
          </div>
        )}

        <div style={sectionTitle}>Timing 信息</div>
        {!timingExists ? (
          <div style={{ color: '#999', fontSize: 12 }}>（该日志无 timing 数据）</div>
        ) : (
          <>
            <div style={rowStyle}>
              <span style={labelStyle}>请求 ID:</span>
              <span style={{ fontFamily: 'SF Mono, Menlo, monospace', marginRight: 8 }}>
                {r.request_id || '-'}
              </span>
              {r.request_id && (
                <Button size="small" onClick={() => copyText(r.request_id)}>
                  复制
                </Button>
              )}
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>状态:</span>
              {fmtTimingStatus(r.timing_status)}
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>状态码:</span>
              {r.timing_status_code ? r.timing_status_code : '-'}
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>慢标记:</span>
              {fmtSlowReason(r.slow_reason)}
            </div>

            <div style={{ ...rowStyle, marginTop: 10, fontWeight: 500 }}>阶段耗时:</div>
            <div style={{ ...rowStyle, paddingLeft: 16 }}>
              <span style={labelStyle}>渠道选择:</span>
              {fmtMs(r.select_ms)}
            </div>
            <div style={{ ...rowStyle, paddingLeft: 16 }}>
              <span style={labelStyle}>请求发起:</span>
              {fmtMs(r.upstream_request_start_ms)}
            </div>
            <div style={{ ...rowStyle, paddingLeft: 16 }}>
              <span style={labelStyle}>收到 header:</span>
              {fmtMs(r.upstream_header_ms)}
            </div>
            <div style={{ ...rowStyle, paddingLeft: 16 }}>
              <span style={labelStyle}>首 chunk:</span>
              {fmtMs(r.first_chunk_ms)}
              {upstreamWait !== null && (
                <span style={{ color: '#666', marginLeft: 8 }}>
                  (上游等待 {upstreamWait} ms)
                </span>
              )}
            </div>
            <div style={{ ...rowStyle, paddingLeft: 16 }}>
              <span style={labelStyle}>首次转发:</span>
              {fmtMs(r.first_write_ms)}
              {writeGap !== null && (
                <span style={{ color: '#666', marginLeft: 8 }}>
                  (转发延迟 {writeGap} ms)
                </span>
              )}
            </div>
            <div style={{ ...rowStyle, paddingLeft: 16 }}>
              <span style={labelStyle}>总耗时:</span>
              {fmtMs(r.elapsed_time)}
            </div>

            <div style={{ ...rowStyle, marginTop: 10 }}>
              <span style={labelStyle}>Retry:</span>
              {parseInt(r.retry_count) > 0
                ? `${r.retry_count} 次${r.last_retry_status ? `（末次状态码 ${r.last_retry_status}）` : ''}`
                : '0 次'}
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>错误摘要:</span>
              <span style={{ color: r.timing_error ? '#FF3B30' : '#666', wordBreak: 'break-all' }}>
                {r.timing_error || '（无）'}
              </span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>上游 ID:</span>
              <span style={{ fontFamily: 'SF Mono, Menlo, monospace' }}>
                {r.upstream_request_id || '-'}
              </span>
            </div>
          </>
        )}
      </div>
    );

    Modal.info({
      title: '日志详情',
      content,
      centered: true,
      width: 560,
      okText: '关闭',
    });
  };

  // 渠道筛选项：使用后端返回的全量去重列表（按时间区间，非仅当前页）
  const channelOptions = useMemo(
    () =>
      (optionData.channels || [])
        .map((v) => String(v))
        .map((v) => ({ text: v, value: v })),
    [optionData.channels],
  );

  // 模型筛选项：使用后端返回的全量去重列表（按时间区间，非仅当前页）
  const modelOptions = useMemo(
    () => (optionData.models || []).map((v) => ({ text: v, value: v })),
    [optionData.models],
  );

  const allColumns = [
    {
      title: '时间',
      dataIndex: 'timestamp2string',
      sorter: true,
      sortOrder: sorter.field === 'created_at' ? sorter.order : null,
    },
    isAdminUser && {
      title: '渠道',
      dataIndex: 'channel',
      filters: channelOptions,
      filterMultiple: false,
      filteredValue: filters.channel ? [filters.channel] : [],
      render: (text, record) => {
        if (record.type !== 0 && record.type !== 2) return null;
        return (
          <Tag color={colors[parseInt(text) % colors.length]} size="large"> {text} </Tag>
        );
      },
    },
    isAdminUser && {
      title: '用户',
      dataIndex: 'username',
      sorter: true,
      sortOrder: sorter.field === 'username' ? sorter.order : null,
      render: (text, record) => (
        <span style={{ cursor: 'pointer' }} onClick={() => showUserInfo(record.user_id)}>
          {text}
        </span>
      ),
    },
    {
      title: '令牌',
      dataIndex: 'token_name',
      sorter: true,
      sortOrder: sorter.field === 'token_name' ? sorter.order : null,
      render: (text, record) =>
        record.type === 0 || record.type === 2 ? (
          <Tag color="grey" size="large" onClick={() => copyText(text)}>
            {text}
          </Tag>
        ) : null,
    },
    {
      title: '类型',
      dataIndex: 'type',
      filters: TYPE_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
      filterMultiple: true,
      filteredValue: filters.types,
      render: (text) => renderType(text),
    },
    {
      title: '模型',
      dataIndex: 'model_name',
      filters: modelOptions,
      filterMultiple: false,
      filteredValue: filters.model ? [filters.model] : [],
      render: (text, record) =>
        record.type === 0 || record.type === 2 ? (
          <Tag color={stringToColor(text)} size="large" onClick={() => copyText(text)}>
            {text}
          </Tag>
        ) : null,
    },
    {
      title: '提示',
      dataIndex: 'prompt_tokens',
      sorter: true,
      sortOrder: sorter.field === 'prompt_tokens' ? sorter.order : null,
      render: (text, record) =>
        record.type === 0 || record.type === 2 ? <span>{text}</span> : null,
    },
    {
      title: '补全',
      dataIndex: 'completion_tokens',
      sorter: true,
      sortOrder: sorter.field === 'completion_tokens' ? sorter.order : null,
      render: (text, record) =>
        parseInt(text) > 0 && (record.type === 0 || record.type === 2) ? (
          <span>{text}</span>
        ) : null,
    },
    {
      title: '缓存读',
      dataIndex: 'cache_read_tokens',
      render: (text, record) =>
        parseInt(text) > 0 && (record.type === 0 || record.type === 2) ? (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{text}</span>
        ) : null,
    },
    {
      title: '缓存写',
      dataIndex: 'cache_write_tokens',
      render: (text, record) =>
        parseInt(text) > 0 && (record.type === 0 || record.type === 2) ? (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{text}</span>
        ) : null,
    },
    {
      title: '命中率',
      dataIndex: 'cache_hit_rate',
      render: (_, record) => renderCacheHitRate(record),
    },
    {
      title: '花费',
      dataIndex: 'quota',
      sorter: true,
      sortOrder: sorter.field === 'quota' ? sorter.order : null,
      render: (text, record) =>
        record.type === 0 || record.type === 2 ? <span>{renderQuota(text, 6)}</span> : null,
    },
    {
      title: '首响应',
      dataIndex: 'first_chunk_ms',
      sorter: true,
      sortOrder: sorter.field === 'first_chunk_ms' ? sorter.order : null,
      render: (text) => renderTimingMs(text),
    },
    {
      title: '总耗时',
      dataIndex: 'elapsed_time',
      sorter: true,
      sortOrder: sorter.field === 'elapsed_time' ? sorter.order : null,
      render: (text) => renderTimingMs(text),
    },
    {
      title: '状态',
      dataIndex: 'timing_status',
      filters: [
        { text: '正常', value: 'ok' },
        { text: '错误', value: 'error' },
        { text: '首包慢', value: 'first_chunk' },
        { text: '总耗时慢', value: 'total' },
      ],
      filterMultiple: false,
      filteredValue: filters.status ? [filters.status] : [],
      render: (_, record) => renderTimingStatus(record),
    },
    {
      title: '详情',
      dataIndex: 'content',
      align: 'left',
      render: (text) => (
        <Paragraph
          ellipsis={{ rows: 2, showTooltip: { type: 'popover', opts: { style: { width: 240 } } } }}
          style={{ maxWidth: 240 }}
        >
          {text}
        </Paragraph>
      ),
    },
    {
      title: '操作',
      dataIndex: 'detail_action',
      render: (_, record) => (
        <Button size="small" theme="borderless" onClick={() => showLogDetail(record)}>
          查看
        </Button>
      ),
    },
  ].filter(Boolean).map((col) => ({ align: 'center', ...col }));

  const { visibleColumns: columns, columnConfigButton } = useColumnConfig({
    storageKey: COLUMN_STORAGE_KEY,
    columnMeta: COLUMN_META.filter((c) => !(c.adminOnly && !isAdminUser)),
    allColumns,
    buttonProps: { theme: 'borderless', type: 'tertiary', children: '显示项' },
  });

  const onTableChange = ({ filters: newFilters, sorter: newSorter }) => {
    let nextFilters = filters;
    if (Array.isArray(newFilters)) {
      const pick = (key) => {
        const item = newFilters.find((f) => f.dataIndex === key);
        const val = item?.filteredValue?.[0];
        return val === undefined || val === null ? '' : val;
      };
      // 类型为多选，取整个数组（空数组=全部）
      const typeItem = newFilters.find((f) => f.dataIndex === 'type');
      const types = Array.isArray(typeItem?.filteredValue) ? typeItem.filteredValue : [];
      nextFilters = {
        types,
        model: pick('model_name') || '',
        status: pick('timing_status') || '',
        channel: pick('channel') || '',
      };
      // 仅当变化时才更新（避免 sort 触发时重复 setFilters）
      const sameTypes =
        types.length === filters.types.length &&
        types.every((v, i) => v === filters.types[i]);
      const changed =
        !sameTypes || ['model', 'status', 'channel'].some((k) => nextFilters[k] !== filters[k]);
      if (changed) {
        setFilters(nextFilters);
        setActivePage(1);
      }
    }
    if (newSorter) {
      const field = newSorter.dataIndex || '';
      const order = newSorter.sortOrder || '';
      if (field !== sorter.field || order !== sorter.order) {
        // 时间列对应后端 created_at 字段
        const backendField = field === 'timestamp2string' ? 'created_at' : field;
        setSorter({ field: order ? backendField : '', order });
        setActivePage(1);
      }
    }
  };

  const handlePageChange = (page) => {
    setActivePage(page);
    if (page === Math.ceil(logs.length / pageSize) + 1) {
      loadLogs(page - 1, pageSize);
    }
  };

  const handlePageSizeChange = async (size) => {
    localStorage.setItem('page-size', size + '');
    setPageSize(size);
    setActivePage(1);
    try {
      await loadLogs(0, size);
    } catch (e) {
      showError(e?.message || '加载失败');
    }
  };

  const pageData = logs.slice((activePage - 1) * pageSize, activePage * pageSize);

  // 初始加载
  useEffect(() => {
    const local = parseInt(localStorage.getItem('page-size')) || ITEMS_PER_PAGE;
    setPageSize(local);
    loadLogs(0, local).catch((e) => showError(e?.message || '加载失败'));
    loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 任意筛选/排序变化后刷新
  useEffect(() => {
    setActivePage(1);
    loadLogs(0, pageSize).catch((e) => showError(e?.message || '加载失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sorter, timeRange]);

  // 时间区间变化后重新拉取全量筛选选项（筛选/排序变化不影响可选项集合）
  useEffect(() => {
    loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange]);

  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          flexShrink: 0,
          gap: 12,
        }}
      >
        <Space spacing={12}>
          <DatePicker
            type="dateTimeRange"
            density="compact"
            value={timeRange}
            onChange={(v) => setTimeRange(v)}
            style={{ width: 360 }}
            placeholder={['开始时间', '结束时间']}
          />
          {isAdminUser && (
            <Input
              value={usernameKeyword}
              onChange={(v) => setUsernameKeyword(v)}
              onEnterPress={refresh}
              placeholder="搜索用户名"
              showClear
              style={{ width: 200 }}
            />
          )}
          {isAdminUser && (
            <Button onClick={refresh} loading={loading}>
              搜索
            </Button>
          )}
        </Space>
        {columnConfigButton}
      </div>
      <div ref={tableWrapRef}>
        <Table
          columns={columns}
          dataSource={pageData}
          loading={loading}
          onChange={onTableChange}
          rowKey="id"
          scroll={{ y: scrollY }}
          sticky={{ top: 0 }}
          pagination={{
            currentPage: activePage,
            pageSize: pageSize,
            total: logCount,
            showSizeChanger: true,
            popoverPosition: 'topRight',
            pageSizeOpts: [10, 20, 50, 100],
            formatPageText: (page) => `第 ${page.currentStart} - ${page.currentEnd} 条，共 ${logs.length} 条`,
            onPageSizeChange: (size) => {
              handlePageSizeChange(size);
            },
            onPageChange: handlePageChange,
          }}
        />
      </div>
    </div>
  );
};

export default LogsTable;
