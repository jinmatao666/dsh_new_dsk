import React, { useEffect, useState } from 'react';
import { API, copy, showError, showSuccess, timestamp2string } from '../helpers';
import { renderQuota } from '../helpers/render';
import { Button, Modal, Popconfirm, Popover, Space, Table, Tag } from '@douyinfe/semi-ui';
import EditUserToken from './EditUserToken';

function renderTimestamp(timestamp) {
  return <>{timestamp2string(timestamp)}</>;
}

function renderStatus(status) {
  switch (status) {
    case 1:
      return <Tag color="green" size="small">已启用</Tag>;
    case 2:
      return <Tag color="red" size="small">已禁用</Tag>;
    case 3:
      return <Tag color="yellow" size="small">已过期</Tag>;
    case 4:
      return <Tag color="grey" size="small">已耗尽</Tag>;
    default:
      return <Tag size="small">未知</Tag>;
  }
}

function renderExpire(expiredTime) {
  if (expiredTime === -1) {
    return <Tag size="small">永不过期</Tag>;
  }
  return <span style={{ fontSize: 12 }}>{renderTimestamp(expiredTime)}</span>;
}

const UserTokensSubTable = ({ userId }) => {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editingToken, setEditingToken] = useState({ id: undefined });

  const loadTokens = async () => {
    setLoading(true);
    const res = await API.get(`/api/admin/token/user/${userId}`);
    const { success, message, data } = res.data;
    if (success) {
      setTokens(data || []);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const manage = async (record, action) => {
    let res;
    if (action === 'delete') {
      res = await API.delete(`/api/admin/token/user/${userId}/${record.id}`);
    } else {
      const status = action === 'enable' ? 1 : 2;
      res = await API.put(`/api/admin/token/user/${userId}?status_only=true`, {
        id: record.id,
        status
      });
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess('操作成功');
      await loadTokens();
    } else {
      showError(message);
    }
  };

  const copyKey = async (key) => {
    if (await copy('sk-' + key)) {
      showSuccess('已复制到剪贴板');
    } else {
      Modal.error({ title: '无法复制到剪贴板，请手动复制', content: 'sk-' + key });
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (text) => renderStatus(text)
    },
    {
      title: '剩余额度',
      dataIndex: 'remain_quota',
      width: 110,
      render: (text, record) =>
        record.unlimited_quota ? (
          <Tag size="small" color="white">无限制</Tag>
        ) : (
          <span style={{ fontSize: 12 }}>{renderQuota(parseInt(text))}</span>
        )
    },
    {
      title: '已用额度',
      dataIndex: 'used_quota',
      width: 110,
      render: (text) => <span style={{ fontSize: 12 }}>{renderQuota(parseInt(text))}</span>
    },
    {
      title: '期限',
      dataIndex: 'expired_time',
      width: 170,
      render: (text) => renderExpire(text)
    },
    {
      title: '操作',
      dataIndex: 'op',
      render: (_, record) => (
        <Space spacing={4}>
          <Popover content={'sk-' + record.key} position="top">
            <Button size="small" theme="borderless" type="tertiary">查看</Button>
          </Popover>
          <Button
            size="small"
            theme="borderless"
            type="secondary"
            onClick={() => copyKey(record.key)}
          >
            复制
          </Button>
          <Button
            size="small"
            theme="borderless"
            type="tertiary"
            onClick={() => {
              setEditingToken(record);
              setShowEdit(true);
            }}
          >
            编辑
          </Button>
          {record.status === 1 ? (
            <Button
              size="small"
              theme="borderless"
              type="warning"
              onClick={() => manage(record, 'disable')}
            >
              禁用
            </Button>
          ) : (
            <Button
              size="small"
              theme="borderless"
              type="secondary"
              onClick={() => manage(record, 'enable')}
              disabled={record.status === 3}
            >
              启用
            </Button>
          )}
          <Popconfirm
            title="确定要删除此令牌？"
            content="此操作不可逆"
            okType="danger"
            position="left"
            onConfirm={() => manage(record, 'delete')}
          >
            <Button size="small" theme="borderless" type="danger">删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: '8px 16px 16px 48px', background: 'var(--semi-color-fill-0)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>令牌（{tokens.length}）</span>
        <Button
          size="small"
          theme="light"
          type="primary"
          onClick={() => {
            setEditingToken({ id: undefined });
            setShowEdit(true);
          }}
        >
          添加令牌
        </Button>
      </div>
      <Table
        size="small"
        columns={columns}
        dataSource={tokens}
        rowKey="id"
        pagination={false}
        loading={loading}
        empty={<div style={{ padding: 16, color: 'var(--semi-color-text-2)' }}>暂无令牌</div>}
      />
      <EditUserToken
        userId={userId}
        editingToken={editingToken}
        visible={showEdit}
        handleClose={() => {
          setShowEdit(false);
          setTimeout(() => setEditingToken({ id: undefined }), 300);
        }}
        refresh={loadTokens}
      />
    </div>
  );
};

export default UserTokensSubTable;
