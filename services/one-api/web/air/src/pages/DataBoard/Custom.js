import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Col,
  Empty,
  Input,
  Row,
  Select,
  TreeSelect,
  Typography,
} from '@douyinfe/semi-ui';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Download, Plus, Trash2 } from 'lucide-react';
import { API, showError, showWarning, downloadTextAsFile } from '../../helpers';
import {
  EVENT_FIELD_LABELS,
  SUBDIVIDE_CARDINALITY_LIMIT,
  ANONYMOUS_EVENTS,
  buildEventTree,
  expandToEventNames,
} from '../../constants/clientEvents';
import ChartCard, { CHART_TYPE_LABELS, PERIOD_LABELS, VALUE_MODE_LABELS } from './ChartCard';

const { Text } = Typography;

const PERIOD_OPTIONS = Object.entries(PERIOD_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const CHART_TYPE_OPTIONS = Object.entries(CHART_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const METRIC_OPTIONS = [
  { value: 'count', label: '事件次数（按事件分组）' },
  { value: 'trend', label: '事件趋势（按日期分组）' },
  { value: 'list', label: '事件明细列表' },
];

// 把事件分类树转成 Semi TreeSelect 需要的 treeData。
// value：父级用节点 key（如 'app.auth'），叶子用事件名；label 展示中文。
// 勾选父级即选中其下全部叶子（配合 TreeSelect 的 leafOnly + 多选）。
const treeToTreeData = (nodes) =>
  (nodes || []).map((node) => {
    const children = [
      ...((node.children || []).length ? treeToTreeData(node.children) : []),
      ...((node.events || []).map((ev) => ({ label: ev, value: ev, key: ev }))),
    ];
    return {
      label: node.label,
      value: node.key,
      key: node.key,
      children: children.length ? children : undefined,
    };
  });

const DEFAULT_FORM = {
  title: '',
  period: '7d',
  chartType: 'line',
  metric: 'trend',
  // eventNames 存实际事件名（叶子）。埋点事件选择器用多级树，选父级即展开成其下全部叶子。
  eventNames: [],
  subdivide: '',
  valueMode: 'pv',
  // 漏斗层级(仅 chartType==='funnel' 使用):每层 = 事件 +(可选)细分字段的确定单值。
  funnelLayers: [],
};

// 漏斗层展示名:优先用户自定义 name;否则按 事件·字段=值 自动生成,无细分则用事件名。
const funnelLayerLabel = (layer) => {
  if (!layer) return '';
  if (layer.name && layer.name.trim()) return layer.name.trim();
  if (layer.field && layer.value) return `${layer.event}·${layer.field}=${layer.value}`;
  return layer.event || '';
};

// 检测漏斗是否同时混用了匿名事件（官网访问/下载，无 user_id）和登录事件。
// 后端漏斗按用户去重键（登录=user_id、匿名=device_id/username）逐层求交，
// 两类事件身份键不互通，混在一起会让相邻层交集恒为 0，导致某层“没数据”。
// 返回混用时的匿名事件名列表（去重），无混用返回空数组。
const mixedIdentityAnonEvents = (layers) => {
  const events = (layers || [])
    .filter((l) => l && l.event)
    .map((l) => l.event);
  if (events.length < 2) return [];
  const anon = [...new Set(events.filter((e) => ANONYMOUS_EVENTS.includes(e)))];
  const hasLoggedIn = events.some((e) => !ANONYMOUS_EVENTS.includes(e));
  return anon.length > 0 && hasLoggedIn ? anon : [];
};

// 规范化从后端读回或本地新建的漏斗层,补齐字段。
const normalizeLayer = (l, idx) => ({
  id: l.id != null ? l.id : `layer_${idx}_${l.event || ''}`,
  event: l.event || '',
  field: l.field || '',
  value: l.value || '',
  name: l.name || '',
});

const loadCharts = async () => {
  const res = await API.get('/api/dashboard/custom');
  if (!res.data.success) throw new Error(res.data.message || '加载失败');
  const rows = res.data.data || [];
  return rows.map((r) => {
    let cfg = {};
    try { cfg = JSON.parse(r.config) || {}; } catch (e) { /* ignore */ }
    return {
      id: r.id,
      title: r.title,
      period: cfg.period || '7d',
      chartType: cfg.chartType || 'line',
      metric: cfg.metric || 'trend',
      eventNames: Array.isArray(cfg.eventNames) ? cfg.eventNames : [],
      subdivide: cfg.subdivide || '',
      valueMode: cfg.valueMode === 'uv' ? 'uv' : 'pv',
      // 漏斗层:优先读 funnelLayers;旧漏斗图无此字段时用 eventNames 兜底(每事件一层、无细分)。
      funnelLayers: Array.isArray(cfg.funnelLayers)
        ? cfg.funnelLayers.map(normalizeLayer)
        : cfg.chartType === 'funnel' && Array.isArray(cfg.eventNames)
          ? cfg.eventNames.map((ev, i) => normalizeLayer({ event: ev }, i))
          : [],
    };
  });
};

const createChart = async (chart) => {
  const config = JSON.stringify({
    period: chart.period,
    chartType: chart.chartType,
    metric: chart.metric,
    eventNames: chart.eventNames,
    subdivide: chart.subdivide || '',
    valueMode: chart.valueMode || 'pv',
    funnelLayers: chart.chartType === 'funnel' ? (chart.funnelLayers || []) : [],
  });
  const res = await API.post('/api/dashboard/custom', { title: chart.title, config });
  if (!res.data.success) throw new Error(res.data.message || '保存失败');
  return { ...chart, id: res.data.data.id };
};

const deleteChartRemote = async (id) => {
  const res = await API.delete(`/api/dashboard/custom/${id}`);
  if (!res.data.success) throw new Error(res.data.message || '删除失败');
};

// 细分仅在锁定单个事件时生效（细分维度按事件采样）。
const canSubdivide = (chart) => (chart.eventNames || []).length === 1;

const buildQuery = (chart) => {
  const params = new URLSearchParams();
  params.set('period', chart.period);
  if (chart.eventNames && chart.eventNames.length > 0) {
    params.set('event_names', chart.eventNames.join(','));
  }
  if (chart.subdivide && canSubdivide(chart)) {
    params.set('subdivide', chart.subdivide);
  }
  return params.toString();
};

// 漏斗取数:调用后端 /funnel 接口做"用户维度逐层求交",返回每层累积交集的去重用户数(UV)。
// 后端保证单调递减(下层是上层子集)。层展示名优先用前端自定义 name。
// 结果映射到 ChartCard 现有 data.stats 通道:漏斗只用 UV,count 也填 users 保证渲染不为 0。
const fetchFunnelData = async (chart) => {
  const layers = (chart.funnelLayers || []).filter((l) => l.event && (!l.field || l.value));
  if (layers.length < 2) return { stats: [] };
  const specs = layers.map((l) => ({ event: l.event, field: l.field || '', value: l.value || '' }));
  const params = new URLSearchParams();
  params.set('period', chart.period);
  params.set('layers', JSON.stringify(specs));
  const res = await API.get(`/api/client-event/funnel?${params.toString()}`);
  if (!res.data.success) throw new Error(res.data.message || '加载失败');
  const backLayers = res.data.data.layers || [];
  return {
    stats: backLayers.map((L, i) => ({
      event_name: funnelLayerLabel(layers[i]) || L.name,
      count: L.users || 0,
      unique_users: L.users || 0,
    })),
  };
};

const fetchChartData = async (chart) => {
  if (chart.chartType === 'funnel') {
    return fetchFunnelData(chart);
  }
  const qs = buildQuery(chart);
  if (chart.metric === 'list') {
    const res = await API.get(`/api/client-event/list?${qs}&page=1&per_page=50`);
    if (res.data.success) {
      return { list: res.data.data.items || [] };
    }
    throw new Error(res.data.message || '加载失败');
  }
  const res = await API.get(`/api/client-event/stats?${qs}`);
  if (res.data.success) {
    return {
      stats: res.data.data.stats || [],
      trend: res.data.data.trend || [],
    };
  }
  throw new Error(res.data.message || '加载失败');
};

// CSV 单元格转义：含逗号/引号/换行的值用双引号包裹，内部引号翻倍。
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rowsToCsv = (headers, rows) =>
  [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

// 把当前参数对应的数据集转成 CSV 文本。按 metric 组织列：
// - list：时间/用户/事件/附加数据 明细
// - trend：日期/事件/PV/UV 趋势（细分时事件列即细分取值）
// - count：事件（或细分取值）/PV/UV 汇总
// 返回 null 表示无数据。
const buildCsv = (chart, data) => {
  if (chart.metric === 'list') {
    const list = data?.list || [];
    if (list.length === 0) return null;
    const rows = list.map((it) => [
      it.created_at ? new Date(it.created_at).toLocaleString() : '',
      it.username || '',
      it.event_name || '',
      it.event_data || '',
    ]);
    return rowsToCsv(['时间', '用户', '事件', '附加数据'], rows);
  }
  const dimLabel = chart.subdivide ? chart.subdivide : '事件';
  if (chart.metric === 'trend') {
    const trend = data?.trend || [];
    if (trend.length === 0) return null;
    const rows = trend.map((t) => [
      t.date,
      t.event_name || '全部',
      t.count ?? 0,
      t.unique_users ?? 0,
    ]);
    return rowsToCsv(['日期', dimLabel, '次数(PV)', '独立用户(UV)'], rows);
  }
  const stats = data?.stats || [];
  // 漏斗图：用户维度逐层求交,只用 UV(去重用户)。stats 已按层顺序、单调递减。
  if (chart.chartType === 'funnel') {
    if (stats.length === 0) return null;
    const uv0 = stats[0]?.unique_users || 0;
    const fmtPct = (v, base) => (base > 0 ? `${((v / base) * 100).toFixed(1)}%` : '0%');
    const rows = stats.map((cur, i) => {
      const uv = cur.unique_users || 0;
      const uvPrev = (i === 0 ? cur : stats[i - 1])?.unique_users || 0;
      return [
        i + 1,
        cur.event_name,
        uv,
        i === 0 ? '-' : fmtPct(uv, uvPrev),
        fmtPct(uv, uv0),
      ];
    });
    return rowsToCsv(['层级', '事件', '用户数(UV)', '相对上层', '相对首层'], rows);
  }
  if (stats.length === 0) return null;
  const rows = stats.map((s) => [s.event_name, s.count ?? 0, s.unique_users ?? 0]);
  return rowsToCsv([dimLabel, '次数(PV)', '独立用户(UV)'], rows);
};

const inferChartType = (metric, current) => {
  if (metric === 'list') return 'table';
  if (metric === 'trend') {
    // 趋势不支持饼图/表格/漏斗，回落到折线
    return current === 'pie' || current === 'table' || current === 'funnel' ? 'line' : current;
  }
  return current === 'line' ? 'bar' : current === 'table' ? 'bar' : current;
};

// buildSubdivideOptions 把后端返回的字段元信息（{key, cardinality, samples}）
// 转成细分维度下拉选项。启发式：低基数枚举字段（≤ 阈值）标为“推荐”排在前面，
// 并展示中文含义 + 样例值；高基数字段（name/id/error 等）归到“其他字段”末尾，
// 便于识别但不误选。字段中文含义优先取字典 EVENT_FIELD_LABELS，缺失则留空。
const buildSubdivideOptions = (subdivideKeys) => {
  // 兼容两种后端返回：新格式 {key, cardinality, samples}；
  // 旧格式（后端未重启时）为纯字符串数组 ["action", ...]。
  const keys = (subdivideKeys || []).map((k) =>
    typeof k === 'string' ? { key: k, cardinality: 0, samples: [] } : k,
  );

  const recommended = [];
  const others = [];
  keys.forEach((k) => {
    const meaning = EVENT_FIELD_LABELS[k.key] || '';
    const sample = (k.samples || []).slice(0, 3).join('/');
    // 旧格式无基数信息（cardinality=0）时，一律当作可选项列在推荐区。
    const treatAsRecommended =
      k.cardinality === 0 || k.cardinality <= SUBDIVIDE_CARDINALITY_LIMIT;
    if (treatAsRecommended) {
      const suffix = sample ? ` (${sample}${k.cardinality > 3 ? '…' : ''})` : '';
      recommended.push({
        value: k.key,
        label: `${k.key}${meaning ? ' ' + meaning : ''}${suffix}`,
      });
    } else {
      others.push({
        value: k.key,
        label: `${k.key}${meaning ? ' ' + meaning : ''}（取值较多，不建议）`,
      });
    }
  });

  const options = [{ value: '', label: '不细分' }, ...recommended];
  if (others.length > 0) {
    // 用一个禁用项作为分隔标题，视觉上区分推荐与其他字段。
    options.push({ value: '__divider__', label: '── 其他字段 ──', disabled: true });
    options.push(...others);
  }
  return options;
};

const DataCustom = () => {
  const [charts, setCharts] = useState([]);
  const [chartData, setChartData] = useState({});
  const [loadingMap, setLoadingMap] = useState({});
  const [discoveredNames, setDiscoveredNames] = useState([]);
  const [formExpanded, setFormExpanded] = useState(true);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [subdivideKeys, setSubdivideKeys] = useState([]);
  // 漏斗每层的可细分字段与字段取值候选,按 event / event||field 为 key 缓存,避免重复请求。
  const [funnelKeysCache, setFunnelKeysCache] = useState({}); // event -> [{key,cardinality,samples}]
  const [funnelValuesCache, setFunnelValuesCache] = useState({}); // `${event}||${field}` -> [value]

  useEffect(() => {
    (async () => {
      try {
        const list = await loadCharts();
        setCharts(list);
      } catch (e) {
        showError(e.message);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get('/api/client-event/event-names?days=30');
        if (res.data.success) {
          setDiscoveredNames(res.data.data || []);
        }
      } catch (e) {
        // 接口失败时仍然可以使用代码中维护的事件清单
      }
    })();
  }, []);

  // 锁定单个事件时，拉取该事件 event_data 的可细分字段；否则清空。
  const singleEvent = form.eventNames.length === 1 ? form.eventNames[0] : '';
  useEffect(() => {
    if (!singleEvent) {
      setSubdivideKeys([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get(`/api/client-event/data-keys?event_name=${encodeURIComponent(singleEvent)}&days=30`);
        if (!cancelled && res.data.success) {
          setSubdivideKeys(res.data.data || []);
        }
      } catch (e) {
        if (!cancelled) setSubdivideKeys([]);
      }
    })();
    return () => { cancelled = true; };
  }, [singleEvent]);

  // 拉取某事件的可细分字段(带缓存),供漏斗层的"细分字段"下拉使用。
  const ensureFunnelKeys = useCallback(async (event) => {
    if (!event || funnelKeysCache[event]) return;
    try {
      const res = await API.get(`/api/client-event/data-keys?event_name=${encodeURIComponent(event)}&days=30`);
      if (res.data.success) {
        setFunnelKeysCache((m) => ({ ...m, [event]: res.data.data || [] }));
      }
    } catch (e) {
      setFunnelKeysCache((m) => ({ ...m, [event]: [] }));
    }
  }, [funnelKeysCache]);

  // 拉取某事件某字段的全部取值(带缓存),供漏斗层的"取值"下拉使用。
  // 取值即 subdivided stats 的桶名(event_name)。
  const ensureFunnelValues = useCallback(async (event, field) => {
    if (!event || !field) return;
    const key = `${event}||${field}`;
    if (funnelValuesCache[key]) return;
    try {
      const params = new URLSearchParams();
      params.set('period', '30d');
      params.set('event_names', event);
      params.set('subdivide', field);
      const res = await API.get(`/api/client-event/stats?${params.toString()}`);
      if (res.data.success) {
        const values = (res.data.data.stats || [])
          .map((s) => s.event_name)
          .filter((v) => v && v !== '未设置');
        setFunnelValuesCache((m) => ({ ...m, [key]: values }));
      }
    } catch (e) {
      setFunnelValuesCache((m) => ({ ...m, [key]: [] }));
    }
  }, [funnelValuesCache]);

  // 漏斗模式下,预取所有层的字段列表与取值候选。
  useEffect(() => {
    if (form.chartType !== 'funnel') return;
    (form.funnelLayers || []).forEach((l) => {
      if (l.event) ensureFunnelKeys(l.event);
      if (l.event && l.field) ensureFunnelValues(l.event, l.field);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.chartType, JSON.stringify(form.funnelLayers)]);

  const refreshChart = useCallback(async (chart) => {
    setLoadingMap((m) => ({ ...m, [chart.id]: true }));
    try {
      const data = await fetchChartData(chart);
      setChartData((d) => ({ ...d, [chart.id]: data }));
    } catch (e) {
      showError(e.message);
    } finally {
      setLoadingMap((m) => ({ ...m, [chart.id]: false }));
    }
  }, []);

  useEffect(() => {
    charts.forEach((c) => {
      if (!chartData[c.id]) refreshChart(c);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charts]);

  useEffect(() => {
    if (!formExpanded) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const data = await fetchChartData(form);
        if (!cancelled) setPreviewData(data);
      } catch (e) {
        if (!cancelled) setPreviewData(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.metric, form.period, form.chartType, form.eventNames.join(','), form.subdivide, JSON.stringify(form.funnelLayers), formExpanded]);

  const handleAdd = async () => {
    if (!form.title.trim()) {
      showError('请输入图表标题');
      return;
    }
    const isFunnel = form.chartType === 'funnel';
    if (isFunnel) {
      const valid = (form.funnelLayers || []).filter(
        (l) => l.event && (!l.field || l.value),
      );
      if (valid.length < 2) {
        showError('漏斗图至少需要 2 个有效层级（每层需选事件，选了细分字段则需选取值）');
        return;
      }
    }
    const draft = {
      title: form.title.trim(),
      period: form.period,
      chartType: form.chartType,
      metric: form.metric,
      eventNames: form.eventNames,
      subdivide: form.eventNames.length === 1 ? form.subdivide : '',
      valueMode: form.valueMode,
      funnelLayers: isFunnel ? form.funnelLayers : [],
    };
    try {
      const saved = await createChart(draft);
      setCharts((cs) => [...cs, saved]);
      refreshChart(saved);
    } catch (e) {
      showError(e.message);
    }
  };

  // 导出当前表单参数对应的数据集为 CSV（复用预览已拉取的 previewData）。
  const handleExport = () => {
    const csv = buildCsv(form, previewData);
    if (!csv) {
      showWarning('当前参数下没有可导出的数据');
      return;
    }
    const namePart =
      form.title.trim() ||
      (form.chartType === 'funnel' ? '漏斗' : form.eventNames.join('_')) ||
      '事件';
    const filename = `数据集_${namePart}_${form.period}.csv`;
    // 加 UTF-8 BOM，保证 Excel 打开中文不乱码。
    downloadTextAsFile('﻿' + csv, filename);
  };

  const handleRemove = async (id) => {
    try {
      await deleteChartRemote(id);
    } catch (e) {
      showError(e.message);
      return;
    }
    setCharts((cs) => cs.filter((c) => c.id !== id));
    setChartData((d) => {
      const copy = { ...d };
      delete copy[id];
      return copy;
    });
  };

  const onMetricChange = (metric) => {
    setForm((f) => ({
      ...f,
      metric,
      chartType: inferChartType(metric, f.chartType),
    }));
  };

  // 事件选择变化：TreeSelect 传回选中的节点 value（可能是父级 key 或叶子事件名），
  // 统一展开成实际事件名列表存入 eventNames。非单一事件时清除细分维度。
  const onEventNamesChange = (v) => {
    const eventNames = expandToEventNames(v || [], discoveredNames);
    setForm((f) => ({
      ...f,
      eventNames,
      subdivide: eventNames.length === 1 ? f.subdivide : '',
    }));
  };

  // ---- 漏斗层级操作 ----
  let funnelIdSeq = 0;
  const addFunnelLayer = () => {
    setForm((f) => ({
      ...f,
      funnelLayers: [
        ...(f.funnelLayers || []),
        { id: `new_${Date.now()}_${funnelIdSeq++}`, event: '', field: '', value: '', name: '' },
      ],
    }));
  };

  // 更新某层字段;改 event 时清空 field/value,改 field 时清空 value。
  const updateFunnelLayer = (idx, patch) => {
    setForm((f) => {
      const layers = (f.funnelLayers || []).map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        if ('event' in patch) { next.field = ''; next.value = ''; }
        if ('field' in patch) { next.value = ''; }
        return next;
      });
      return { ...f, funnelLayers: layers };
    });
  };

  const removeFunnelLayer = (idx) => {
    setForm((f) => ({
      ...f,
      funnelLayers: (f.funnelLayers || []).filter((_, i) => i !== idx),
    }));
  };

  // 上移/下移某层(dir = -1 上, +1 下)。
  const moveFunnelLayer = (idx, dir) => {
    setForm((f) => {
      const layers = [...(f.funnelLayers || [])];
      const target = idx + dir;
      if (target < 0 || target >= layers.length) return f;
      [layers[idx], layers[target]] = [layers[target], layers[idx]];
      return { ...f, funnelLayers: layers };
    });
  };

  const chartTypeOptions = useMemo(() => {
    if (form.metric === 'list') {
      return [{ value: 'table', label: '表格' }];
    }
    if (form.metric === 'trend') {
      // 趋势按日期，漏斗/饼图/表格不适用
      return CHART_TYPE_OPTIONS.filter(
        (o) => o.value !== 'pie' && o.value !== 'table' && o.value !== 'funnel',
      );
    }
    // 次数指标：漏斗图仅在支持排序层级时有意义（保留选项，数据不足时预览提示）
    return CHART_TYPE_OPTIONS.filter((o) => o.value !== 'table');
  }, [form.metric]);

  // 主事件选择器用的多级树（含发现的未归类事件补到「其他」）。
  const eventTreeData = useMemo(
    () => treeToTreeData(buildEventTree(discoveredNames)),
    [discoveredNames],
  );

  // 漏斗层每层的事件下拉仍用扁平列表（单选一个事件），从树里摊平所有叶子。
  const eventOptions = useMemo(() => {
    const flat = [];
    const seen = new Set();
    const walk = (nodes) =>
      (nodes || []).forEach((n) => {
        if (n.children) walk(n.children);
        else if (!seen.has(n.value)) {
          seen.add(n.value);
          flat.push({ value: n.value, label: n.label });
        }
      });
    walk(eventTreeData);
    return flat;
  }, [eventTreeData]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <FormPanel
        expanded={formExpanded}
        onToggle={() => setFormExpanded((v) => !v)}
        form={form}
        setForm={setForm}
        onMetricChange={onMetricChange}
        onEventNamesChange={onEventNamesChange}
        chartTypeOptions={chartTypeOptions}
        eventTreeData={eventTreeData}
        eventOptions={eventOptions}
        subdivideKeys={subdivideKeys}
        funnelKeysCache={funnelKeysCache}
        funnelValuesCache={funnelValuesCache}
        onAddFunnelLayer={addFunnelLayer}
        onUpdateFunnelLayer={updateFunnelLayer}
        onRemoveFunnelLayer={removeFunnelLayer}
        onMoveFunnelLayer={moveFunnelLayer}
        onAdd={handleAdd}
        onExport={handleExport}
        previewData={previewData}
        previewLoading={previewLoading}
      />

      {charts.length === 0 ? (
        <Empty
          title="还没有图表"
          description="在上方表单中配置后点击「添加图表」"
          style={{ padding: '60px 0' }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {charts.map((chart) => (
            <Col span={12} key={chart.id}>
              <ChartCard
                chart={chart}
                data={chartData[chart.id]}
                loading={!!loadingMap[chart.id]}
                onRemove={handleRemove}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default DataCustom;

// ----- Form panel -----

const panelStyle = {
  background: '#FAFAFA',
  border: '1px solid rgba(0,0,0,0.06)',
  borderRadius: 10,
  marginBottom: 24,
};

const FormPanel = ({
  expanded,
  onToggle,
  form,
  setForm,
  onMetricChange,
  onEventNamesChange,
  chartTypeOptions,
  eventTreeData,
  eventOptions,
  subdivideKeys,
  funnelKeysCache,
  funnelValuesCache,
  onAddFunnelLayer,
  onUpdateFunnelLayer,
  onRemoveFunnelLayer,
  onMoveFunnelLayer,
  onAdd,
  onExport,
  previewData,
  previewLoading,
}) => {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;
  const singleEvent = form.eventNames.length === 1;
  const isFunnel = form.chartType === 'funnel';
  const subdivideOptions = buildSubdivideOptions(subdivideKeys);
  // 漏斗混用匿名事件+登录事件时的防呆提示（列出触发混用的匿名事件名）。
  const funnelAnonWarning = isFunnel ? mixedIdentityAnonEvents(form.funnelLayers) : [];

  return (
    <div style={panelStyle}>
      <div
        onClick={onToggle}
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <Text strong style={{ fontSize: 13 }}>新建图表</Text>
        <ChevronIcon size={16} strokeWidth={1.75} style={{ color: '#8F9BBA' }} />
      </div>
      {expanded && (
        <div style={{ padding: '4px 16px 16px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col span={6}>
              <Field label="标题">
                <Input
                  value={form.title}
                  onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                  placeholder="例如：登录异常趋势"
                />
              </Field>
            </Col>
            <Col span={6}>
              <Field label="指标">
                <Select
                  value={form.metric}
                  onChange={onMetricChange}
                  optionList={METRIC_OPTIONS}
                  style={{ width: '100%' }}
                />
              </Field>
            </Col>
            <Col span={6}>
              <Field label="时间区间">
                <Select
                  value={form.period}
                  onChange={(v) => setForm((f) => ({ ...f, period: v }))}
                  optionList={PERIOD_OPTIONS}
                  style={{ width: '100%' }}
                />
              </Field>
            </Col>
            <Col span={6}>
              <Field label="图表类型">
                <Select
                  value={form.chartType}
                  onChange={(v) => setForm((f) => ({ ...f, chartType: v }))}
                  optionList={chartTypeOptions}
                  style={{ width: '100%' }}
                  disabled={form.metric === 'list'}
                />
              </Field>
            </Col>
            {!isFunnel && (
              <Col span={18}>
                <Field label="埋点事件" hint="可只勾父级分类=选中其下全部事件；留空表示全部事件">
                  <TreeSelect
                    multiple
                    filterTreeNode
                    leafOnly
                    value={form.eventNames}
                    onChange={onEventNamesChange}
                    treeData={eventTreeData}
                    placeholder="选择分类或具体事件"
                    style={{ width: '100%' }}
                    maxTagCount={6}
                    showClear
                  />
                </Field>
              </Col>
            )}
            {!isFunnel && (
              <Col span={6}>
                <Field
                  label="细分维度"
                  hint={singleEvent ? '按附加数据字段拆分' : '仅选单个事件时可用'}
                >
                  <Select
                    value={form.subdivide || ''}
                    onChange={(v) => setForm((f) => ({ ...f, subdivide: v || '' }))}
                    optionList={subdivideOptions}
                    placeholder={singleEvent ? '选择细分字段' : '不细分'}
                    style={{ width: '100%' }}
                    disabled={!singleEvent}
                    emptyContent={singleEvent ? '该事件无可细分字段' : null}
                  />
                </Field>
              </Col>
            )}
            <Col span={6}>
              <Field label="默认视图">
                <Select
                  value={form.valueMode || 'pv'}
                  onChange={(v) => setForm((f) => ({ ...f, valueMode: v }))}
                  optionList={[
                    { value: 'pv', label: VALUE_MODE_LABELS.pv },
                    { value: 'uv', label: VALUE_MODE_LABELS.uv },
                  ]}
                  style={{ width: '100%' }}
                  disabled={form.metric === 'list'}
                />
              </Field>
            </Col>
          </Row>
          {isFunnel && (
            <FunnelLayerEditor
              layers={form.funnelLayers || []}
              eventOptions={eventOptions}
              funnelKeysCache={funnelKeysCache}
              funnelValuesCache={funnelValuesCache}
              onAdd={onAddFunnelLayer}
              onUpdate={onUpdateFunnelLayer}
              onRemove={onRemoveFunnelLayer}
              onMove={onMoveFunnelLayer}
            />
          )}
          {isFunnel && funnelAnonWarning.length > 0 && (
            <Banner
              type="warning"
              closeIcon={null}
              style={{ marginTop: 12 }}
              description={
                `漏斗里混用了匿名事件（${funnelAnonWarning.join('、')}）和登录后事件。` +
                '匿名事件上报时没有用户身份，无法与登录用户对齐，逐层求交时相关层会显示为 0。' +
                '建议把匿名官网事件单独做漏斗，或改用折线/次数图分别观察。'
              }
            />
          )}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed rgba(0,0,0,0.06)' }}>
            <Text type="tertiary" style={{ fontSize: 11, marginBottom: 8, display: 'block' }}>预览</Text>
            <ChartCard
              key={`preview-${form.valueMode}`}
              chart={{
                id: '__preview__',
                title: form.title.trim() || '（未命名图表）',
                period: form.period,
                chartType: form.chartType,
                metric: form.metric,
                eventNames: form.eventNames,
                subdivide: singleEvent ? form.subdivide : '',
                valueMode: form.valueMode,
                funnelLayers: form.funnelLayers || [],
              }}
              data={previewData}
              loading={previewLoading}
              readOnly
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <Button
              theme="light"
              type="tertiary"
              icon={<Download size={14} />}
              onClick={onExport}
              loading={previewLoading}
            >
              导出数据
            </Button>
            <Button theme="solid" type="primary" icon={<Plus size={14} />} onClick={onAdd}>
              添加图表
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const Field = ({ label, hint, children }) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: 500 }}>{label}</Text>
      {hint && <Text type="tertiary" style={{ fontSize: 11 }}>{hint}</Text>}
    </div>
    {children}
  </div>
);

// ----- 漏斗层级编辑器 -----
// 每层一行:序号 + 事件 + 细分字段(可"不细分") + 取值(选了字段才启用) + 层名(占位显示自动名) + 排序/删除。
const layerRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 0',
  borderBottom: '1px solid rgba(0,0,0,0.04)',
};

// 把某事件的可细分字段列表转成"细分字段"下拉选项(含"不细分")。
const fieldOptionsFor = (keys) => {
  const opts = [{ value: '', label: '不细分（整事件）' }];
  (keys || []).forEach((k) => {
    const key = typeof k === 'string' ? k : k.key;
    const meaning = EVENT_FIELD_LABELS[key] || '';
    opts.push({ value: key, label: `${key}${meaning ? ' ' + meaning : ''}` });
  });
  return opts;
};

const FunnelLayerEditor = ({
  layers,
  eventOptions,
  funnelKeysCache,
  funnelValuesCache,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
}) => (
  <div style={{ marginTop: 16 }}>
    <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
      漏斗层级（从上到下）
    </Text>
    <Text type="tertiary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
      每层选一个事件；可选细分字段并锁定某个取值。至少 2 层。
    </Text>
    {(layers || []).length === 0 && (
      <Text type="tertiary" style={{ fontSize: 12, display: 'block', padding: '8px 0' }}>
        还没有层级，点击下方按钮添加。
      </Text>
    )}
    {(layers || []).map((layer, idx) => {
      const fieldOpts = fieldOptionsFor(funnelKeysCache[layer.event]);
      const valueList = funnelValuesCache[`${layer.event}||${layer.field}`] || [];
      const valueOpts = valueList.map((v) => ({ value: v, label: v }));
      return (
        <div key={layer.id || idx} style={layerRowStyle}>
          <Text type="tertiary" style={{ fontSize: 12, width: 20, textAlign: 'center' }}>
            {idx + 1}
          </Text>
          <Select
            filter
            value={layer.event || ''}
            onChange={(v) => onUpdate(idx, { event: v })}
            optionList={eventOptions}
            placeholder="选择事件"
            style={{ width: 150 }}
          />
          <Select
            value={layer.field || ''}
            onChange={(v) => onUpdate(idx, { field: v || '' })}
            optionList={fieldOpts}
            placeholder="不细分"
            style={{ width: 130 }}
            disabled={!layer.event}
          />
          <Select
            filter
            value={layer.value || ''}
            onChange={(v) => onUpdate(idx, { value: v || '' })}
            optionList={valueOpts}
            placeholder={layer.field ? '选择取值' : '—'}
            style={{ width: 130 }}
            disabled={!layer.field}
            emptyContent="无可选取值"
          />
          <Input
            value={layer.name || ''}
            onChange={(v) => onUpdate(idx, { name: v })}
            placeholder={funnelLayerLabel(layer) || '层名（可选）'}
            style={{ flex: 1, minWidth: 100 }}
          />
          <ArrowUp
            size={15}
            strokeWidth={1.75}
            style={{ cursor: idx === 0 ? 'not-allowed' : 'pointer', color: idx === 0 ? '#D0D5DD' : '#8F9BBA' }}
            onClick={() => idx > 0 && onMove(idx, -1)}
          />
          <ArrowDown
            size={15}
            strokeWidth={1.75}
            style={{
              cursor: idx === layers.length - 1 ? 'not-allowed' : 'pointer',
              color: idx === layers.length - 1 ? '#D0D5DD' : '#8F9BBA',
            }}
            onClick={() => idx < layers.length - 1 && onMove(idx, 1)}
          />
          <Trash2
            size={15}
            strokeWidth={1.75}
            style={{ cursor: 'pointer', color: '#8F9BBA' }}
            onClick={() => onRemove(idx)}
          />
        </div>
      );
    })}
    <Button
      theme="borderless"
      type="primary"
      icon={<Plus size={14} />}
      onClick={onAdd}
      style={{ marginTop: 8 }}
    >
      添加漏斗层
    </Button>
  </div>
);
