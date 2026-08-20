import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Image, ImagePreview, Input, Select, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { Download } from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Text, Paragraph } = Typography;

const PER_PAGE = 20;
// 导出时逐页拉全量的单页大小，取后端允许的上限，减少往返次数
const EXPORT_PAGE_SIZE = 100;

const cardStyle = {
  borderRadius: 10, border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

const TYPE_META = {
  bug: { label: 'Bug 报告', color: 'red' },
  suggestion: { label: '功能建议', color: 'blue' },
  other: { label: '其他', color: 'grey' },
};

const TYPE_OPTIONS = [
  { value: 'bug', label: 'Bug 报告' },
  { value: 'suggestion', label: '功能建议' },
  { value: 'other', label: '其他' },
];

const COLUMN_META = [
  { key: 'created_at', label: '时间', always: true },
  { key: 'username', label: '用户' },
  { key: 'feedback_type', label: '类型' },
  { key: 'content', label: '内容', always: true },
  { key: 'images', label: '截图' },
  { key: 'app_version', label: '版本' },
];

const COLUMN_STORAGE_KEY = 'feedback_table_visible_columns';

// Images 列存的是 JSON 编码的 base64 data-URL 数组，解析失败时兜底为空
function parseImages(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s) : [];
  } catch {
    return [];
  }
}

const Feedback = () => {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [username, setUsername] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchList = async (p = 1) => {
    setLoading(true);
    try {
      let url = `/api/feedback/list?page=${p}&per_page=${PER_PAGE}`;
      if (typeFilter) url += `&feedback_type=${encodeURIComponent(typeFilter)}`;
      if (username) url += `&username=${encodeURIComponent(username)}`;
      const res = await API.get(url);
      // 拦截器在请求失败时会 showError 后返回 undefined，这里需防空
      if (res?.data?.success) {
        setList(res.data.data.items || []);
        setTotal(res.data.data.total || 0);
        setPage(p);
      } else if (res?.data) {
        showError(res.data.message || '加载失败');
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, username]);

  const allColumns = [
    {
      title: '时间', dataIndex: 'created_at', width: 170,
      render: (v) => new Date(v * 1000).toLocaleString(),
    },
    { title: '用户', dataIndex: 'username', width: 140, render: (v) => v || 'anonymous' },
    {
      title: '类型', dataIndex: 'feedback_type', width: 110,
      render: (v) => {
        const meta = TYPE_META[v] || { label: v || '-', color: 'grey' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '内容', dataIndex: 'content',
      render: (v) => (
        <Paragraph style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 4, expandable: true, collapsible: true }}>
          {v}
        </Paragraph>
      ),
    },
    {
      title: '截图', dataIndex: 'images', width: 160,
      render: (raw) => {
        const imgs = parseImages(raw);
        if (!imgs.length) return <Text type="tertiary" style={{ fontSize: 12 }}>无</Text>;
        return (
          <ImagePreview>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {imgs.map((src, i) => (
                <Image
                  key={i}
                  src={src}
                  width={44}
                  height={44}
                  style={{ borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.06)' }}
                />
              ))}
            </div>
          </ImagePreview>
        );
      },
    },
    { title: '版本', dataIndex: 'app_version', width: 100, render: (v) => v || '-' },
  ];

  const { visibleColumns: columns, columnConfigButton, visibleKeys } = useColumnConfig({
    storageKey: COLUMN_STORAGE_KEY,
    columnMeta: COLUMN_META,
    allColumns,
    buttonProps: {
      theme: 'borderless',
      type: 'tertiary',
      style: { color: 'var(--semi-color-text-0)' },
      children: '列配置',
    },
  });

  // 导出当前筛选条件下的全部反馈为 CSV。逐页拉取以突破单页上限，
  // 导出列与「列配置」可见列同步；截图为 base64 过大，仅输出张数。
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = [];
      let p = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let url = `/api/feedback/list?page=${p}&per_page=${EXPORT_PAGE_SIZE}`;
        if (typeFilter) url += `&feedback_type=${encodeURIComponent(typeFilter)}`;
        if (username) url += `&username=${encodeURIComponent(username)}`;
        const res = await API.get(url);
        if (!res?.data?.success) {
          showError(res?.data?.message || '导出失败');
          return;
        }
        const items = res.data.data.items || [];
        all.push(...items);
        const totalCount = res.data.data.total || 0;
        if (all.length >= totalCount || items.length === 0) break;
        p += 1;
      }
      if (!all.length) {
        showError('没有可导出的反馈');
        return;
      }

      // 每个可配置列对应的导出表头与取值
      const exportFields = {
        created_at: { label: '时间', get: (r) => (r.created_at ? new Date(r.created_at * 1000).toLocaleString() : '') },
        username: { label: '用户', get: (r) => r.username || 'anonymous' },
        feedback_type: { label: '类型', get: (r) => (TYPE_META[r.feedback_type]?.label || r.feedback_type || '') },
        content: { label: '内容', get: (r) => r.content || '' },
        images: { label: '截图数', get: (r) => parseImages(r.images).length },
        app_version: { label: '版本', get: (r) => r.app_version || '' },
      };
      // 按列配置顺序取可见列
      const keys = COLUMN_META
        .map((m) => m.key)
        .filter((k) => exportFields[k] && (COLUMN_META.find((m) => m.key === k)?.always || visibleKeys.includes(k)));
      const escape = (v) => {
        const s = v === undefined || v === null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = keys.map((k) => exportFields[k].label);
      const lines = all.map((r) => keys.map((k) => exportFields[k].get(r)).map(escape).join(','));
      const csv = [header.join(','), ...lines].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccess(`已导出 ${all.length} 条反馈`);
    } catch (e) {
      showError(e.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Input
            prefix={<IconSearch />}
            value={usernameInput}
            onChange={setUsernameInput}
            onEnterPress={() => setUsername(usernameInput.trim())}
            style={{ width: 220 }}
            placeholder="搜索用户，回车"
            showClear
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 160 }}
            placeholder="筛选类型"
            showClear
            optionList={TYPE_OPTIONS}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            theme="borderless"
            type="tertiary"
            style={{ color: 'var(--semi-color-text-0)' }}
            icon={<Download size={16} />}
            loading={exporting}
            onClick={exportCsv}
          >
            导出列表
          </Button>
          {columnConfigButton}
        </div>
      </div>

      <Spin spinning={loading}>
        <Card style={cardStyle} bodyStyle={{ padding: 0 }}>
          <Table
            columns={columns}
            dataSource={list}
            rowKey="id"
            size="small"
            empty={<Empty description="暂无反馈数据" style={{ padding: '48px 0' }} />}
            scroll={{ y: 'calc(100vh - 280px)' }}
            sticky={{ top: 0 }}
            pagination={{
              currentPage: page,
              pageSize: PER_PAGE,
              total,
              formatPageText: (p) => `第 ${p.currentStart} - ${p.currentEnd} 条，共 ${total} 条`,
              onPageChange: fetchList,
            }}
          />
        </Card>
      </Spin>
    </div>
  );
};

export default Feedback;
