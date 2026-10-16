import React, { useEffect, useState } from 'react';
import { Card, Input, Select, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { API, showError } from '../../helpers';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Text } = Typography;

const PER_PAGE = 20;

const cardStyle = {
  borderRadius: 10, border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

const AdminOperationLog = () => {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState('7d');
  const [actionFilter, setActionFilter] = useState('');
  const [actionOptions, setActionOptions] = useState([]);
  const [usernameInput, setUsernameInput] = useState('');
  const [username, setUsername] = useState('');

  const fetchActions = async () => {
    try {
      const res = await API.get('/api/admin-operation-log/actions');
      if (res.data.success) {
        setActionOptions((res.data.data || []).map((a) => ({ value: a, label: a })));
      }
    } catch (e) {
      showError(e.message);
    }
  };

  const fetchList = async (p = 1) => {
    setLoading(true);
    try {
      let url = `/api/admin-operation-log/list?period=${period}&page=${p}&per_page=${PER_PAGE}`;
      if (actionFilter) url += `&action=${encodeURIComponent(actionFilter)}`;
      if (username) url += `&username=${encodeURIComponent(username)}`;
      const res = await API.get(url);
      if (res.data.success) {
        setLogs(res.data.data.items || []);
        setTotal(res.data.data.total || 0);
        setPage(p);
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchActions();
  }, []);

  useEffect(() => {
    fetchList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, actionFilter, username]);

  const columns = [
    { title: '时间', dataIndex: 'created_at', width: 170, render: (v) => new Date(v).toLocaleString() },
    { title: '操作者', dataIndex: 'admin_username', width: 120 },
    { title: '模块', dataIndex: 'module', width: 110, render: (v) => v || '-' },
    { title: '操作', dataIndex: 'action', width: 150, render: (v) => <Tag>{v}</Tag> },
    { title: '目标', dataIndex: 'target_id', width: 80, render: (v) => v || '-' },
    { title: '详情', dataIndex: 'detail', render: (v) => v ? <Text copyable style={{ fontSize: 12 }}>{v}</Text> : '-' },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v) => v || '-' },
    { title: '路径', dataIndex: 'path', width: 200, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'admin_operation_log_table_visible_columns',
    columnMeta: [
      { key: 'created_at', label: '时间', always: true },
      { key: 'admin_username', label: '操作者' },
      { key: 'module', label: '模块' },
      { key: 'action', label: '操作' },
      { key: 'target_id', label: '目标' },
      { key: 'detail', label: '详情' },
      { key: 'ip', label: 'IP' },
      { key: 'path', label: '路径' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Input
            value={usernameInput}
            onChange={setUsernameInput}
            onEnterPress={() => setUsername(usernameInput.trim())}
            style={{ width: 180 }}
            placeholder="搜索操作者，回车"
            showClear
          />
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
            value={actionFilter}
            onChange={setActionFilter}
            style={{ width: 180 }}
            placeholder="筛选操作类型"
            showClear
            optionList={actionOptions}
          />
          {columnConfigButton}
        </div>
      </div>

      <Spin spinning={loading}>
        <Card style={cardStyle} bodyStyle={{ padding: 0 }}>
          <Table
            columns={visibleColumns}
            dataSource={logs}
            rowKey="id"
            size="small"
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

export default AdminOperationLog;
