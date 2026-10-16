import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Button, Table, Tag, Modal, Input, Space, Typography, TextArea } from '@douyinfe/semi-ui';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';

const { Text, Paragraph } = Typography;

// 平台作为一级 tab；后台无真实版本号，按探测到的重启事件成行。
const PLATFORMS = [
  { key: 'app', label: 'App 客户端' },
  { key: 'web', label: '主站' },
  { key: 'backend', label: '后台' },
];

const fmtTime = (v) => (v ? new Date(v).toLocaleString() : '-');

// 语义化版本比较：a>b 返回正，a<b 返回负，相等返回 0。
// 逐段按数值比较（v1.2.0 / 1.2 / 1.2.0-beta 都能处理），非数字段回退到字符串比较。
const compareVersion = (a, b) => {
  const parse = (v) => String(v || '').replace(/^v/i, '').split(/[.\-+]/);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i], 10);
    const nb = parseInt(pb[i], 10);
    const aNum = !Number.isNaN(na);
    const bNum = !Number.isNaN(nb);
    if (aNum && bNum) {
      if (na !== nb) return na - nb;
    } else {
      const sa = pa[i] || '';
      const sb = pb[i] || '';
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
};

// 用 canvas 测文本像素宽，复用单个 context 避免反复创建。
let _measureCtx = null;
const measureText = (text, font = '13px -apple-system, system-ui, sans-serif') => {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = font;
  return _measureCtx.measureText(String(text == null ? '' : text)).width;
};

// 列宽分配：每列按内容自适应，单列上限为「总宽÷列数」的等分宽，
// 再把所有列省下的余量平均分摊回各列，填满整张表格。
//   cells: 每列的字符串数组（含表头）；total: 表格可用总宽。
// 返回与列同序的像素宽数组（之和等于 total）。
const allocateColumnWidths = (cells, total) => {
  const n = cells.length;
  if (!n || !(total > 0)) return cells.map(() => undefined);
  const PAD = 33; // 单元格左右内边距 + 排序/边框冗余
  const equal = total / n; // 等分上限
  // 每列自然宽 = 该列最宽内容，封顶到等分宽
  const natural = cells.map((col) => {
    const w = col.reduce((m, t) => Math.max(m, measureText(t)), 0) + PAD;
    return Math.min(w, equal);
  });
  const used = natural.reduce((a, b) => a + b, 0);
  const slack = total - used; // 各列封顶后省出的余量
  const per = slack > 0 ? slack / n : 0; // 平均分摊
  const widths = natural.map((w) => Math.floor(w + per));
  // 取整误差补到最后一列，保证总和精确等于 total
  const diff = total - widths.reduce((a, b) => a + b, 0);
  widths[n - 1] += diff;
  return widths;
};

// 每个平台一张统一表：合并「更新说明」与「发布记录(探测)」。
// 合并键：app/web 用版本号；后台无版本号，用探测信号 signal(start_time=...)，
// 对应说明记录的 version 也存该 signal，保证两边能 merge 到同一行。
const PlatformPanel = ({ platform }) => {
  const isBackend = platform === 'backend';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  // form.locked: 版本号由探测行决定，不可改（仅手动新增 app/web 说明时可编辑）
  const [form, setForm] = useState({ id: 0, version: '', notes: '', locked: false });
  // 表格容器宽度，用于按内容自适应分配列宽
  const wrapRef = useRef(null);
  const [tableWidth, setTableWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      setTableWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mergeKey = (rec) => (isBackend ? (rec.signal !== undefined ? rec.signal : rec.version) : rec.version);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [noteRes, relRes] = await Promise.all([
        API.get(`/api/version-note/?platform=${platform}`),
        API.get(`/api/version-release/?platform=${platform}`),
      ]);
      if (!noteRes.data.success) { showError(noteRes.data.message); setLoading(false); return; }
      if (!relRes.data.success) { showError(relRes.data.message); setLoading(false); return; }
      const notes = noteRes.data.data || [];
      const releases = relRes.data.data || [];
      const map = new Map();
      const upsert = (k) => {
        if (!map.has(k)) map.set(k, { key: k, note: null, release: null });
        return map.get(k);
      };
      releases.forEach((r) => { const k = mergeKey(r); if (k) upsert(k).release = r; });
      notes.forEach((n) => { const k = mergeKey(n); if (k) upsert(k).note = n; });
      const list = [...map.values()];
      const ts = (e) => new Date(e.release?.detected_at || e.note?.updated_at || e.note?.created_at || 0).getTime();
      if (isBackend) {
        // 后台无版本号，仍按探测到的重启时间倒序（最新重启在顶部）
        list.sort((a, b) => ts(b) - ts(a));
      } else {
        // app/web 有真实版本号：按版本号倒序（最新版本在顶部），
        // 避免编辑旧版本说明时 updated_at 把旧行顶到前面；版本号相同再按时间倒序兜底。
        const ver = (row) => row.release?.version || row.note?.version || row.key || '';
        list.sort((a, b) => compareVersion(ver(b), ver(a)) || ts(b) - ts(a));
      }
      setRows(list);
    } catch (e) {
      showError('加载失败');
    }
    setLoading(false);
    // mergeKey 仅依赖 isBackend，已由 platform 决定，无需额外列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  useEffect(() => { load(); }, [load]);

  // 手动新增说明（主要给 app/web 在发布前预填）
  const openCreate = () => { setForm({ id: 0, version: '', notes: '', locked: false }); setShowEdit(true); };
  // 给已探测到的行补/改说明：版本号锁定为该行的 key
  const openEditRow = (row) => {
    const note = row.note;
    setForm({
      id: note?.id || 0,
      version: note?.version || row.key,
      notes: note?.notes || '',
      locked: !note || !!row.release, // 探测行或已有说明都锁版本号
    });
    setShowEdit(true);
  };

  const handleSave = async () => {
    const version = (form.version || '').trim();
    if (!version) { showError('版本号不能为空'); return; }
    if (!form.notes.trim()) { showError('更新说明不能为空'); return; }
    const payload = { id: form.id, platform, version, notes: form.notes };
    setSaving(true);
    try {
      const res = form.id
        ? await API.put('/api/version-note/', payload)
        : await API.post('/api/version-note/', payload);
      if (res.data.success) {
        showSuccess(form.id ? '已更新' : '已保存');
        setShowEdit(false);
        load();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('保存失败');
    }
    setSaving(false);
  };

  const handleDelete = (row) => {
    if (!row.note) return;
    Modal.confirm({
      title: '删除更新说明',
      content: `确定删除「${versionLabel(row)}」的更新说明？发布记录不受影响。`,
      onOk: async () => {
        const res = await API.delete(`/api/version-note/${row.note.id}`);
        if (res.data.success) { showSuccess('已删除'); load(); }
        else showError(res.data.message);
      },
    });
  };

  const versionLabel = (row) => {
    if (isBackend) return row.release ? `重启 @ ${fmtTime(row.release.detected_at)}` : (row.note?.version || row.key);
    return row.release?.version || row.note?.version || row.key;
  };

  // 各列用于测量的纯文本（含表头），与下方 columns 渲染内容对应。
  const releaseText = (row) => {
    if (!row.release) return '未探测到发布';
    if (isBackend) return `已重启 ${fmtTime(row.release.detected_at)}`;
    return `已发布 ${row.release.version || '—'} ${fmtTime(row.release.detected_at)}`;
  };
  const colHeaders = [isBackend ? '重启事件' : '版本号', '更新说明', '发布状态'];
  // 操作列固定宽（两个图标按钮），不参与内容测量；其余三列按内容自适应。
  const cellTexts = useMemo(() => {
    const verCol = [colHeaders[0]];
    const noteCol = [colHeaders[1]];
    const relCol = [colHeaders[2]];
    rows.forEach((row) => {
      verCol.push(`　${versionLabel(row)}　`); // Tag 自带左右内边距
      noteCol.push(row.note?.notes ? row.note.notes.split('\n')[0] : '暂无，点击编辑添加');
      relCol.push(releaseText(row));
    });
    return [verCol, noteCol, relCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, isBackend]);

  const colWidths = useMemo(() => {
    if (!(tableWidth > 0)) return [undefined, undefined, undefined, 88];
    const OP_W = 88; // 操作列固定宽（两个图标按钮 + 间距）
    const dyn = allocateColumnWidths(cellTexts, tableWidth - OP_W);
    return [...dyn, OP_W];
  }, [cellTexts, tableWidth]);

  const columns = [
    {
      title: isBackend ? '重启事件' : '版本号',
      width: colWidths[0],
      render: (t, row) => <Tag color={isBackend ? 'orange' : 'blue'}>{versionLabel(row)}</Tag>,
    },
    {
      title: '更新说明',
      width: colWidths[1],
      render: (t, row) =>
        row.note?.notes ? (
          <Paragraph
            ellipsis={{ rows: 2, showTooltip: true }}
            style={{ margin: 0, whiteSpace: 'pre-wrap' }}
          >
            {row.note.notes}
          </Paragraph>
        ) : (
          <Text type="tertiary" style={{ fontSize: 13 }}>暂无，点击编辑添加</Text>
        ),
    },
    {
      title: '发布状态',
      width: colWidths[2],
      render: (t, row) => {
        if (!row.release) return <Text type="tertiary">未探测到发布</Text>;
        if (isBackend) {
          return (
            <Space>
              <Tag color="green">已重启</Tag>
              <Text type="tertiary" style={{ fontSize: 13 }}>{fmtTime(row.release.detected_at)}</Text>
            </Space>
          );
        }
        return (
          <Space>
            <Tag color="green">已发布</Tag>
            <Text style={{ fontSize: 13 }}>{row.release.version || '—'}</Text>
            <Text type="tertiary" style={{ fontSize: 13 }}>{fmtTime(row.release.detected_at)}</Text>
          </Space>
        );
      },
    },
    {
      title: '操作',
      width: colWidths[3],
      render: (t, row) => (
        <Space>
          <Button size="small" icon={<Pencil size={14} />} onClick={() => openEditRow(row)} />
          <Button
            size="small"
            type="danger"
            icon={<Trash2 size={14} />}
            disabled={!row.note}
            onClick={() => handleDelete(row)}
          />
        </Space>
      ),
    },
  ];

  const hint = isBackend
    ? '后台无真实版本号，系统按进程重启时间近似记录发布；可为每次重启补充更新说明。'
    : platform === 'web'
      ? '系统每小时探测主站线上版本变化并记录；可为每个探测到的版本补充更新说明。'
      : '发布脚本按「版本号」读取此处说明写入更新清单；右侧发布状态由系统探测线上实际发布版本与时间。';

  return (
    <>
      <div style={{ margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="tertiary" style={{ fontSize: 13 }}>{hint}</Text>
        <Space>
          <Button onClick={load} loading={loading}>刷新</Button>
          {!isBackend && <Button icon={<Plus size={16} />} theme="solid" onClick={openCreate}>新增说明</Button>}
        </Space>
      </div>
      <div ref={wrapRef}>
        <Table columns={columns} dataSource={rows} loading={loading} rowKey="key" pagination={{ pageSize: 20 }} />
      </div>

      <Modal
        title={form.id ? '编辑更新说明' : '新增更新说明'}
        visible={showEdit}
        onOk={handleSave}
        onCancel={() => setShowEdit(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          {!(isBackend && form.locked) && (
            <div>
              <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>版本号</Text>
              <Input
                value={form.version}
                disabled={form.locked}
                onChange={(v) => setForm({ ...form, version: v })}
                placeholder="如 2.0.4（不带 v 前缀）"
              />
            </div>
          )}
          <div>
            <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>更新说明（Markdown）</Text>
            <TextArea
              value={form.notes}
              onChange={(v) => setForm({ ...form, notes: v })}
              autosize={{ minRows: 6, maxRows: 16 }}
              placeholder={'## 更新通知\n1. 修复已知问题\n2. 新增功能...'}
            />
          </div>
        </div>
      </Modal>
    </>
  );
};

const VersionRelease = () => (
  <ConfigPageTabs defaultActiveKey="app">
    {PLATFORMS.map((p) => (
      <ConfigPageTabPane tab={p.label} itemKey={p.key} key={p.key}>
        <PlatformPanel platform={p.key} />
      </ConfigPageTabPane>
    ))}
  </ConfigPageTabs>
);

export default VersionRelease;
