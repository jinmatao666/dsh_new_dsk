import React, { useEffect, useState } from 'react';
import { Modal, Table, Tag, Typography, Spin, Empty, Button } from '@douyinfe/semi-ui';
import { API, showError, timestamp2string } from '../helpers';
import { renderQuota } from '../helpers/render';

const { Title, Text } = Typography;

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

const UserActivityModal = ({ visible, userId, username, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [allItems, setAllItems] = useState([]);
  const [page, setPage] = useState(1);
  const [snapshotModal, setSnapshotModal] = useState({ open: false, record: null });
  const pageSize = 20;

  const load = async () => {
    if (!userId || userId <= 0) return;
    setLoading(true);
    try {
      const [logsRes, changesRes] = await Promise.all([
        API.get(`/api/user/${userId}/activity-logs?page=0&size=200`),
        API.get(`/api/admin/account-type-changes?page=0&size=200&user_id=${userId}`),
      ]);

      const logs = logsRes.data.success
        ? (logsRes.data.data?.items || []).map((item) => ({
            ...item,
            _rowType: 'activity',
            _sortMs: item.created_at * 1000,
          }))
        : [];

      const changes = changesRes.data.success
        ? (changesRes.data.data?.items || []).map((item) => ({
            ...item,
            _rowType: 'change',
            _sortMs: new Date(item.created_at).getTime(),
          }))
        : [];

      const merged = [...logs, ...changes].sort((a, b) => b._sortMs - a._sortMs);
      setAllItems(merged);
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (visible && userId) {
      setPage(1);
      load();
    }
  }, [visible, userId]);

  const columns = [
    {
      title: '时间',
      width: 180,
      render: (_, r) =>
        r._rowType === 'change'
          ? formatTime(r.created_at)
          : timestamp2string(r.created_at),
    },
    {
      title: '类型',
      width: 110,
      render: (_, r) => {
        if (r._rowType === 'change') return <Tag color="violet">账户变更</Tag>;
        if (r.type === 1) return <Tag color="green">充值</Tag>;
        if (r.type === 3) return <Tag color="blue">管理操作</Tag>;
        return <Tag>{r.type}</Tag>;
      },
    },
    {
      title: '内容',
      render: (_, r) => {
        if (r._rowType === 'change') {
          const orgLabel =
            r.direction === 'personal_to_enterprise' ? `→ 企业 #${r.to_org_id}` :
            r.direction === 'enterprise_to_personal' ? `企业 #${r.from_org_id} →` :
            r.direction === 'migration_v0' ? `→ 企业 #${r.to_org_id}` : null;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {renderDirection(r.direction)}
              {orgLabel && <Text type="tertiary" style={{ fontSize: 13 }}>{orgLabel}</Text>}
              {r.reason && <Text style={{ fontSize: 13 }}>{r.reason}</Text>}
              {r.admin_id === 0
                ? <Tag color="grey" size="small">系统</Tag>
                : <Text type="tertiary" style={{ fontSize: 12 }}>管理员 #{r.admin_id}</Text>}
              {r.quota_snapshot && (
                <Button
                  size="small"
                  theme="borderless"
                  onClick={() => setSnapshotModal({ open: true, record: r })}
                >
                  查看快照
                </Button>
              )}
            </div>
          );
        }
        return <Text style={{ fontSize: 13 }}>{r.content || '-'}</Text>;
      },
    },
    {
      title: '额度变更',
      width: 130,
      render: (_, r) => {
        if (r._rowType === 'change') return <Text type="tertiary">-</Text>;
        const val = r.quota;
        if (!val || val === 0) return <Text type="tertiary">-</Text>;
        const isPositive = val > 0;
        return (
          <Tag color={isPositive ? 'green' : 'red'}>
            {isPositive ? '+' : ''}{renderQuota(val)}
          </Tag>
        );
      },
    },
  ];

  const pageData = allItems.slice((page - 1) * pageSize, page * pageSize);

  const parsedSnapshot = (() => {
    if (!snapshotModal.record?.quota_snapshot) return null;
    try {
      return JSON.parse(snapshotModal.record.quota_snapshot);
    } catch (_) {
      return { _raw: snapshotModal.record.quota_snapshot };
    }
  })();

  return (
    <Modal
      title={`账户动态 — ${username || `用户 #${userId}`}`}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      bodyStyle={{ padding: '8px 24px 24px' }}
    >
      <Text type="tertiary" style={{ fontSize: 13, display: 'block', margin: '8px 0 12px' }}>
        记录后台对该用户的积分充值、管理操作，以及个体 ↔ 企业身份切换历史
      </Text>
      <Spin spinning={loading}>
        {allItems.length === 0 && !loading ? (
          <Empty description="暂无记录" style={{ padding: '40px 0' }} />
        ) : (
          <Table
            columns={columns}
            dataSource={pageData}
            pagination={{
              currentPage: page,
              pageSize,
              total: allItems.length,
              onPageChange: setPage,
            }}
            rowKey={(r) => `${r._rowType}-${r.id}`}
            size="small"
          />
        )}
      </Spin>

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
    </Modal>
  );
};

export default UserActivityModal;
