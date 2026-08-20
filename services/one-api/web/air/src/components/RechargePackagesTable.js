import React, { useEffect, useState } from 'react';
import { API, showError, showSuccess } from '../helpers';
import { Button, Popconfirm, Table, Tag } from '@douyinfe/semi-ui';
import EditRechargePackage from '../pages/RechargePackage/EditRechargePackage';

// 分 → 元 展示
function renderYuan(cents) {
  return `¥${((parseInt(cents) || 0) / 100).toFixed(2)}`;
}

function renderFeatures(features) {
  if (!features || features === '' || features === '[]') return '-';
  try {
    const arr = JSON.parse(features);
    if (!Array.isArray(arr) || arr.length === 0) return '-';
    return arr.join('、');
  } catch (e) {
    return features;
  }
}

const RechargePackagesTable = () => {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editingPackage, setEditingPackage] = useState({ id: undefined });

  const closeEdit = () => {
    setShowEdit(false);
    setTimeout(() => {
      setEditingPackage({ id: undefined });
    }, 500);
  };

  const loadPackages = async () => {
    setLoading(true);
    const res = await API.get('/api/recharge-package/');
    const { success, message, data } = res.data;
    if (success) {
      setPackages(data || []);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPackages().then();
  }, []);

  // 切换启用状态：仅传 id + enabled
  const toggleEnabled = async (record) => {
    const res = await API.put('/api/recharge-package/?status_only=true', {
      id: record.id,
      enabled: !record.enabled
    });
    const { success, message } = res.data;
    if (success) {
      showSuccess(record.enabled ? '已停用' : '已启用');
      loadPackages();
    } else {
      showError(message);
    }
  };

  const deletePackage = async (record) => {
    const res = await API.delete(`/api/recharge-package/${record.id}`);
    const { success, message } = res.data;
    if (success) {
      showSuccess('删除成功');
      loadPackages();
    } else {
      showError(message);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '每月积分',
      dataIndex: 'point',
      render: (text) => <span>{text}</span>
    },
    { title: '等级', dataIndex: 'level', width: 64 },
    {
      title: '展示价',
      dataIndex: 'price',
      render: (text) => renderYuan(text)
    },
    {
      title: '月付价',
      dataIndex: 'monthly_price',
      render: (text, record) =>
        record.monthly_price_sale > 0
          ? `${renderYuan(record.monthly_price_sale)}（原 ${renderYuan(text)}）`
          : renderYuan(text)
    },
    {
      title: '年付价',
      dataIndex: 'yearly_price',
      render: (text, record) =>
        record.yearly_price_sale > 0
          ? `${renderYuan(record.yearly_price_sale)}（原 ${renderYuan(text)}）`
          : renderYuan(text)
    },
    {
      title: '角标',
      dataIndex: 'badge',
      render: (text) => (text ? <Tag color="orange" size="large">{text}</Tag> : '-')
    },
    {
      title: '特性',
      dataIndex: 'features',
      render: (text) => (
        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>
          {renderFeatures(text)}
        </span>
      )
    },
    { title: '排序', dataIndex: 'sort', width: 64 },
    {
      title: '状态',
      dataIndex: 'enabled',
      render: (enabled) =>
        enabled ? (
          <Tag color="green" size="large">已启用</Tag>
        ) : (
          <Tag color="grey" size="large">已停用</Tag>
        )
    },
    {
      title: '',
      dataIndex: 'operate',
      render: (text, record) => (
        <div>
          <Button
            theme="light"
            type="tertiary"
            style={{ marginRight: 8 }}
            onClick={() => {
              setEditingPackage(record);
              setShowEdit(true);
            }}
          >
            编辑
          </Button>
          <Button
            theme="light"
            type={record.enabled ? 'warning' : 'secondary'}
            style={{ marginRight: 8 }}
            onClick={() => toggleEnabled(record)}
          >
            {record.enabled ? '停用' : '启用'}
          </Button>
          <Popconfirm
            title="确定要删除此商品？"
            content="删除后不可恢复"
            okType="danger"
            position="left"
            onConfirm={() => deletePackage(record)}
          >
            <Button theme="light" type="danger">删除</Button>
          </Popconfirm>
        </div>
      )
    }
  ];

  return (
    <>
      <EditRechargePackage
        refresh={loadPackages}
        visible={showEdit}
        handleClose={closeEdit}
        editingPackage={editingPackage}
      />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
        <Button
          theme="solid"
          type="primary"
          onClick={() => {
            setEditingPackage({ id: undefined });
            setShowEdit(true);
          }}
        >
          新建商品
        </Button>
        <Button theme="light" type="tertiary" style={{ marginLeft: 8 }} onClick={loadPackages}>
          刷新
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={packages}
        loading={loading}
        pagination={false}
        rowKey="id"
      />
    </>
  );
};

export default RechargePackagesTable;
