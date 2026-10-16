import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Select, Input, Button, Modal, Typography, Space } from '@douyinfe/semi-ui';
import { API, showError } from '../../helpers';
import { renderQuota } from '../../helpers/render';
import useColumnConfig from '../../hooks/useColumnConfig';

const COLUMN_META = [
  { key: 'id', label: 'ID', always: true },
  { key: 'user_id', label: '用户 ID' },
  { key: 'direction', label: '方向' },
  { key: 'org', label: '企业' },
  { key: 'admin_id', label: '操作管理员' },
  { key: 'reason', label: '原因' },
  { key: 'snapshot', label: '快照' },
  { key: 'created_at', label: '时间' },
];

const { Title, Text, Paragraph } = Typography;

const cardStyle = {
  borderRadius: 10,
  border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

const DIRECTION_OPTIONS = [
  { value: '', label: '全部方向' },
  { value: 'personal_to_enterprise', label: '个体 → 企业' },
  { value: 'enterprise_to_personal', label: '企业 → 个体' },
  { value: 'migration_v0', label: '历史数据迁移' },
];

const renderDirection = (direction) => {
  switch (direction) {
    case 'personal_to_enterprise':
      return <Tag color="violet">个体 → 企业</Tag>;
    case 'enterprise_to_personal':
      return <Tag color="orange">企业 → 个体</Tag>;
    case 'migration_v0':
      return <Tag color="grey">历史迁移</Tag>;
    default:
      return <Tag>{direction || '未知'}</Tag>;
  }
};

const formatTime = (s) => (s ? new Date(s).toLocaleString() : '-');
// 订阅到期展示口径：后端 current_period_end 是「失效起始时刻」（对齐某天 00:00，到期当天 0 点即失效），
// 故最后可用日 = current_period_end - 1ms，仅日期。与用户端展示保持一致，便于对账。
const formatSubExpiry = (s) => {
  if (!s) return '-';
  const d = new Date(new Date(s).getTime() - 1);
  if (isNaN(d.getTime())) return '-';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const AccountTypeChanges = () => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [size] = useState(20);
  const [direction, setDirection] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [userId, setUserId] = useState(0);
  const [snapshotModal, setSnapshotModal] = useState({ open: false, record: null });

  const load = async () => {
    setLoading(true);
    try {
      let url = `/api/admin/account-type-changes?page=${page}&size=${size}`;
      if (direction) url += `&direction=${direction}`;
      if (userId > 0) url += `&user_id=${userId}`;
      const res = await API.get(url);
      const { success, message, data } = res.data;
      if (success) {
        setItems(data.items || []);
        setTotal(data.total || 0);
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, direction, userId]);

  const renderSnapshot = (record) => {
    if (!record.quota_snapshot) {
      return <Text type="tertiary">-</Text>;
    }
    return (
      <Button size="small" theme="borderless" onClick={() => setSnapshotModal({ open: true, record })}>
        查看快照
      </Button>
    );
  };

  const parsedSnapshot = (() => {
    if (!snapshotModal.record?.quota_snapshot) return null;
    try {
      return JSON.parse(snapshotModal.record.quota_snapshot);
    } catch (_) {
      return { _raw: snapshotModal.record.quota_snapshot };
    }
  })();

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户 ID', dataIndex: 'user_id', width: 90 },
    { title: '方向', dataIndex: 'direction', render: renderDirection },
    {
      title: '企业',
      dataIndex: 'org',
      render: (_, r) => {
        if (r.direction === 'personal_to_enterprise') return `→ #${r.to_org_id}`;
        if (r.direction === 'enterprise_to_personal') return `#${r.from_org_id} →`;
        if (r.direction === 'migration_v0') return `#${r.to_org_id}`;
        return '-';
      },
    },
    { title: '操作管理员', dataIndex: 'admin_id', render: (v) => (v === 0 ? <Tag color="grey">系统</Tag> : `#${v}`) },
    { title: '原因', dataIndex: 'reason', render: (v) => v || <Text type="tertiary">-</Text> },
    { title: '快照', dataIndex: 'snapshot', render: (_, r) => renderSnapshot(r), width: 110 },
    { title: '时间', dataIndex: 'created_at', render: formatTime, width: 180 },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'accounttypechanges_table_visible_columns',
    columnMeta: COLUMN_META,
    allColumns: columns,
    buttonProps: { theme: 'borderless', children: '列配置' },
  });

  return (
    <div style={{ padding: 16 }}>
      <Card style={cardStyle} bodyStyle={{ padding: 20 }}>
        <Title heading={4} style={{ marginBottom: 12 }}>账户类型变更审计</Title>
        <Paragraph type="tertiary" style={{ marginBottom: 16 }}>
          记录所有 个体 ↔ 企业 身份切换历史。转入企业时的"快照"包含被清零的个人积分账本与订阅，仅作事后审查依据。
        </Paragraph>
        <Space style={{ marginBottom: 16 }}>
          <Select
            value={direction}
            onChange={(v) => { setDirection(v); setPage(0); }}
            style={{ width: 180 }}
            optionList={DIRECTION_OPTIONS}
          />
          <Input
            placeholder="用户 ID"
            value={userIdInput}
            onChange={setUserIdInput}
            style={{ width: 140 }}
            onEnterPress={() => { setUserId(parseInt(userIdInput, 10) || 0); setPage(0); }}
          />
          <Button onClick={() => { setUserId(parseInt(userIdInput, 10) || 0); setPage(0); }}>查询</Button>
          <Button theme="borderless" onClick={() => { setUserIdInput(''); setUserId(0); setDirection(''); setPage(0); }}>重置</Button>
          {columnConfigButton}
        </Space>
        <Table
          columns={visibleColumns}
          dataSource={items}
          loading={loading}
          rowKey="id"
          pagination={{
            currentPage: page + 1,
            pageSize: size,
            total,
            onPageChange: (p) => setPage(p - 1),
          }}
        />
      </Card>

      <Modal
        title={`快照 — 变更 #${snapshotModal.record?.id ?? ''}`}
        visible={snapshotModal.open}
        onCancel={() => setSnapshotModal({ open: false, record: null })}
        footer={null}
        width={720}
      >
        {parsedSnapshot && (
          <div>
            {parsedSnapshot._raw ? (
              <pre style={{ background: '#fafafa', padding: 12, borderRadius: 6, overflow: 'auto' }}>
                {parsedSnapshot._raw}
              </pre>
            ) : (
              <>
                <Title heading={6}>聚合余额（清零前）</Title>
                <ul>
                  <li>剩余额度: {renderQuota(parsedSnapshot.quota || 0)}</li>
                  <li>订阅积分: {renderQuota(parsedSnapshot.subscription_quota || 0)}</li>
                  <li>定时积分: {renderQuota(parsedSnapshot.timed_quota_total || 0)}</li>
                  {parsedSnapshot.org_id ? <li>原企业 ID: {parsedSnapshot.org_id}</li> : null}
                </ul>
                {parsedSnapshot.ledger?.length > 0 && (
                  <>
                    <Title heading={6} style={{ marginTop: 16 }}>账本笔（共 {parsedSnapshot.ledger.length} 条）</Title>
                    <Table
                      pagination={false}
                      size="small"
                      dataSource={parsedSnapshot.ledger}
                      rowKey="id"
                      columns={[
                        { title: 'ID', dataIndex: 'id', width: 70 },
                        { title: '来源', dataIndex: 'source' },
                        { title: '剩余', dataIndex: 'remaining', render: renderQuota },
                        { title: '到期', dataIndex: 'expires_at', render: (v) => (v ? formatTime(v) : '永久') },
                      ]}
                    />
                  </>
                )}
                {parsedSnapshot.subscriptions?.length > 0 && (
                  <>
                    <Title heading={6} style={{ marginTop: 16 }}>活订阅（已 cancelled_on_transfer）</Title>
                    <Table
                      pagination={false}
                      size="small"
                      dataSource={parsedSnapshot.subscriptions}
                      rowKey="id"
                      columns={[
                        { title: 'ID', dataIndex: 'id', width: 70 },
                        { title: '套餐', dataIndex: 'package_id' },
                        { title: '等级', dataIndex: 'package_level' },
                        { title: '周期', dataIndex: 'billing_cycle' },
                        { title: '到期', dataIndex: 'current_period_end', render: formatSubExpiry },
                      ]}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AccountTypeChanges;
