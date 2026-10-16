import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dropdown, Modal, Space, Table, Tag, Input } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../helpers';
import { ConfigPageFooter, ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';
import MemberIdentityConfig from '../MemberIdentityConfig';
import useColumnConfig from '../../hooks/useColumnConfig';

const PRODUCT_COLUMN_META = [
  { key: 'id', label: 'ID', always: true },
  { key: 'name', label: '名称' },
  { key: 'price', label: '售价' },
  { key: 'point', label: '积分数' },
  { key: 'duration', label: '时长' },
  { key: 'point_cycle', label: '发放周期' },
  { key: 'identity_id', label: '会员身份' },
  { key: 'package_type', label: '套餐类型' },
  { key: 'badge', label: '角标' },
  { key: 'sort', label: '排序' },
  { key: 'enabled', label: '状态' },
];

const emptyBaseConfig = {
  TopUpLink: '',
  QuotaPerUnit: '',
  RetryTimes: ''
};

// 时长单位/发放周期 展示文案
const DURATION_LABELS = { day: '天', month: '月', quarter: '季', year: '年' };
const CYCLE_LABELS = { once: '一次性', day: '每天', month: '每月', quarter: '每季', year: '每年' };
const renderDuration = (record) => {
  if ((record.package_type || 'subscription') === 'quota') return '-';
  const unit = DURATION_LABELS[record.duration_unit] || '月';
  return `${record.duration_value || 1} ${unit}`;
};

const ProductManagement = () => {
  const navigate = useNavigate();
  const [scope, setScope] = useState('personal');
  const [packages, setPackages] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [baseConfig, setBaseConfig] = useState({ ...emptyBaseConfig });
  const [originBaseConfig, setOriginBaseConfig] = useState({ ...emptyBaseConfig });
  const [baseConfigLoading, setBaseConfigLoading] = useState(false);
  const baseConfigDirty = JSON.stringify(baseConfig) !== JSON.stringify(originBaseConfig);

  const load = useCallback(async () => {
    setLoading(true);
    setSelectedKeys([]);
    try {
      const [pkgRes, idRes] = await Promise.all([
        API.get(`/api/recharge-package/?scope=${scope}`),
        API.get('/api/member-identity/'),
      ]);
      if (pkgRes.data.success) setPackages(pkgRes.data.data || []);
      else showError(pkgRes.data.message);
      if (idRes.data.success) setIdentities(idRes.data.data || []);
    } catch (e) {
      showError('加载商品失败');
    }
    setLoading(false);
  }, [scope]);

  const loadBaseConfig = useCallback(async () => {
    setBaseConfigLoading(true);
    try {
      const res = await API.get('/api/option/');
      if (res.data.success) {
        const newConfig = { ...emptyBaseConfig };
        res.data.data.forEach((item) => {
          if (item.key === 'TopUpLink') {
            newConfig.TopUpLink = item.value || '';
          } else if (item.key === 'QuotaPerUnit') {
            newConfig.QuotaPerUnit = item.value || '';
          } else if (item.key === 'RetryTimes') {
            newConfig.RetryTimes = item.value || '';
          }
        });
        setBaseConfig(newConfig);
        setOriginBaseConfig(newConfig);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('加载基础配置失败');
    }
    setBaseConfigLoading(false);
  }, []);

  const saveBaseConfig = async () => {
    setBaseConfigLoading(true);
    try {
      for (const [key, value] of Object.entries(baseConfig)) {
        const res = await API.put('/api/option/', { key, value });
        if (!res.data.success) {
          showError(res.data.message);
          setBaseConfigLoading(false);
          return;
        }
      }
      showSuccess('保存成功');
      setOriginBaseConfig(baseConfig);
    } catch (e) {
      showError('保存失败');
    }
    setBaseConfigLoading(false);
  };

  const cancelBaseConfig = () => {
    setBaseConfig(originBaseConfig);
  };

  useEffect(() => {
    if (scope === 'config') loadBaseConfig();
    else if (scope !== 'identity') load();
  }, [scope, load, loadBaseConfig]);

  const openCreate = () => {
    navigate(`/transaction/products/new?scope=${scope}`);
  };

  const openEdit = (record) => {
    navigate(`/transaction/products/${record.id}`, { state: { record, scope } });
  };

  const handleDelete = (record) => {
    if (record.enabled) {
      Modal.warning({
        title: '无法删除',
        content: `「${record.name}」当前处于启用状态，请先停用后再删除。`,
      });
      return;
    }
    Modal.confirm({
      title: '删除商品',
      content: `确定删除「${record.name}」？`,
      onOk: async () => {
        const res = await API.delete(`/api/recharge-package/${record.id}`);
        if (res.data.success) {
          showSuccess('已删除商品');
          load();
        } else {
          showError(res.data.message);
        }
      },
    });
  };

  const submitToggleEnabled = async (record) => {
    const res = await API.put('/api/recharge-package/?status_only=true', {
      id: record.id,
      enabled: !record.enabled
    });
    if (res.data.success) {
      showSuccess(record.enabled ? '已停用商品' : '已启用商品');
      load();
    } else {
      showError(res.data.message);
    }
  };

  const handleToggleEnabled = (record) => {
    const action = record.enabled ? '停用' : '启用';
    Modal.confirm({
      title: `${action}商品`,
      content: `确定${action}「${record.name}」？`,
      onOk: () => submitToggleEnabled(record),
    });
  };

  const selectedRecords = packages.filter((p) => selectedKeys.includes(p.id));

  // 批量启用/停用:循环调用单条 status_only 接口,汇总成功/失败数
  const runBatchToggle = async (enabled) => {
    setBatchLoading(true);
    let ok = 0;
    let fail = 0;
    for (const record of selectedRecords) {
      if (record.enabled === enabled) {
        ok += 1; // 状态已是目标值,视为成功跳过
        continue;
      }
      try {
        const res = await API.put('/api/recharge-package/?status_only=true', {
          id: record.id,
          enabled,
        });
        if (res.data.success) ok += 1;
        else fail += 1;
      } catch (e) {
        fail += 1;
      }
    }
    setBatchLoading(false);
    const action = enabled ? '启用' : '停用';
    if (fail === 0) showSuccess(`已${action} ${ok} 个商品`);
    else showError(`${action}完成:成功 ${ok} 个,失败 ${fail} 个`);
    load();
  };

  const handleBatchToggle = (enabled) => {
    const action = enabled ? '启用' : '停用';
    Modal.confirm({
      title: `批量${action}`,
      content: `确定${action}选中的 ${selectedRecords.length} 个商品？`,
      onOk: () => runBatchToggle(enabled),
    });
  };

  // 批量删除:启用中的商品不允许删除,需先停用
  const handleBatchDelete = () => {
    const enabledOnes = selectedRecords.filter((p) => p.enabled);
    if (enabledOnes.length > 0) {
      Modal.warning({
        title: '无法删除',
        content: `选中的商品中有 ${enabledOnes.length} 个处于启用状态,请先停用后再删除。`,
      });
      return;
    }
    Modal.confirm({
      title: '批量删除',
      content: `确定删除选中的 ${selectedRecords.length} 个商品？此操作不可恢复。`,
      onOk: async () => {
        setBatchLoading(true);
        let ok = 0;
        let fail = 0;
        for (const record of selectedRecords) {
          try {
            const res = await API.delete(`/api/recharge-package/${record.id}`);
            if (res.data.success) ok += 1;
            else fail += 1;
          } catch (e) {
            fail += 1;
          }
        }
        setBatchLoading(false);
        if (fail === 0) showSuccess(`已删除 ${ok} 个商品`);
        else showError(`删除完成:成功 ${ok} 个,失败 ${fail} 个`);
        load();
      },
    });
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '售价',
      dataIndex: 'price',
      width: 100,
      render: (v) => `¥${(Number(v || 0) / 100).toFixed(2)}`,
    },
    { title: '积分数', dataIndex: 'point', render: (v) => Number(v || 0).toLocaleString() },
    {
      title: '时长',
      key: 'duration',
      width: 100,
      render: (_, record) => renderDuration(record),
    },
    {
      title: '发放周期',
      dataIndex: 'point_cycle',
      width: 100,
      render: (v, record) => ((record.package_type || 'subscription') === 'quota' ? '-' : (CYCLE_LABELS[v] || '每月')),
    },
    {
      title: '会员身份',
      dataIndex: 'identity_id',
      width: 130,
      render: (v, record) => {
        if ((record.package_type || 'subscription') === 'quota') return '-';
        if (!v) return '-';
        return identities.find((it) => it.id === v)?.name || `ID:${v}`;
      },
    },
    {
      title: '套餐类型',
      dataIndex: 'package_type',
      width: 120,
      render: (v) => {
        const type = v || 'subscription';
        if (type === 'quota') return <Tag color="orange">增值包</Tag>;
        return <Tag color="cyan">订阅会员</Tag>;
      },
    },
    { title: '角标', dataIndex: 'badge', render: (v) => (v ? <Tag color="blue">{v}</Tag> : '-') },
    { title: '排序', dataIndex: 'sort', width: 80 },
    { title: '状态', dataIndex: 'enabled', render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag color="grey">禁用</Tag>) },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button size="small" theme="solid" type="primary" onClick={() => openEdit(record)}>编辑</Button>
          <Dropdown
            trigger="click"
            position="bottomRight"
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => handleToggleEnabled(record)}>
                  {record.enabled ? '停用' : '启用'}
                </Dropdown.Item>
                <Dropdown.Item type="danger" onClick={() => handleDelete(record)}>
                  删除
                </Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <Button size="small" theme="light" type="secondary">更多</Button>
          </Dropdown>
        </Space>
      ),
    },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'productmanagement_table_visible_columns',
    columnMeta: PRODUCT_COLUMN_META,
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div style={scope === 'config'
      ? { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }
      : { padding: 0 }}>
      <ConfigPageTabs activeKey={scope} onChange={setScope} style={{ marginBottom: 12, flex: '0 0 auto' }}>
        <ConfigPageTabPane tab="个人商品" itemKey="personal" />
        <ConfigPageTabPane tab="企业商品" itemKey="enterprise" />
        <ConfigPageTabPane tab="会员身份" itemKey="identity" />
        <ConfigPageTabPane tab="基础配置" itemKey="config" />
      </ConfigPageTabs>
      {scope === 'identity' ? (
        <MemberIdentityConfig />
      ) : scope === 'config' ? (
        <>
          <div style={{ flex: '1 0 auto', maxWidth: 600 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <label style={{ width: 84, marginRight: 16, fontSize: 14 }}>充值链接</label>
                <Input
                  value={baseConfig.TopUpLink}
                  onChange={(v) => setBaseConfig({ ...baseConfig, TopUpLink: v })}
                  placeholder="输入充值页面完整URL"
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <label style={{ width: 84, marginRight: 16, fontSize: 14 }}>1积分=</label>
                <Input
                  value={baseConfig.QuotaPerUnit}
                  onChange={(v) => setBaseConfig({ ...baseConfig, QuotaPerUnit: v })}
                  type="number"
                  suffix="token"
                  placeholder="例如：500000"
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <label style={{ width: 84, marginRight: 16, fontSize: 14 }}>失败重试次数</label>
                <Input
                  value={baseConfig.RetryTimes}
                  onChange={(v) => setBaseConfig({ ...baseConfig, RetryTimes: v })}
                  type="number"
                  placeholder="例如：3"
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>
          <ConfigPageFooter
            dirty={baseConfigDirty}
            loading={baseConfigLoading}
            saveText="保存配置"
            onCancel={cancelBaseConfig}
            onSave={saveBaseConfig}
          />
        </>
      ) : (
        <>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button theme="solid" onClick={openCreate}>新建商品</Button>
            {columnConfigButton}
            {selectedKeys.length > 0 && (
              <Space style={{ marginLeft: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>
                  已选 {selectedKeys.length} 项
                </span>
                <Button size="small" loading={batchLoading} onClick={() => handleBatchToggle(true)}>批量启用</Button>
                <Button size="small" loading={batchLoading} onClick={() => handleBatchToggle(false)}>批量停用</Button>
                <Button size="small" type="danger" loading={batchLoading} onClick={handleBatchDelete}>批量删除</Button>
              </Space>
            )}
          </div>
          <Table
            columns={visibleColumns}
            dataSource={packages}
            loading={loading}
            rowKey="id"
            pagination={false}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: (keys) => setSelectedKeys(keys),
            }}
          />
        </>
      )}
    </div>
  );
};

export default ProductManagement;
