import React, { useEffect, useState, useCallback } from 'react';
import { Button, Table, Tag, Modal, Input, InputNumber, Select, Space, Switch, Typography } from '@douyinfe/semi-ui';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Title, Text } = Typography;

const emptyIdentityForm = { id: 0, name: '', description: '', package_id: null, package_level: 1, enabled: true };

const emptyForm = {
  id: 0,
  name: '',
  description: '',
  price: 0,      // 分
  point: 0,      // 积分
  badge: '',
  sort: 0,
  enabled: true,
  scope: 'enterprise',
};

const RechargePackages = () => {
  const [scope, setScope] = useState('enterprise');
  const [packages, setPackages] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderUsername, setOrderUsername] = useState('');
  const [orderEnterprise, setOrderEnterprise] = useState('all');
  const [orderStatus, setOrderStatus] = useState('paid');
  const [invoices, setInvoices] = useState([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoiceUsername, setInvoiceUsername] = useState('');
  const [invoiceEnterprise, setInvoiceEnterprise] = useState('all');
  const [invoiceStatus, setInvoiceStatus] = useState('all');
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // 会员身份
  const [identities, setIdentities] = useState([]);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityModalVisible, setIdentityModalVisible] = useState(false);
  const [identityForm, setIdentityForm] = useState(emptyIdentityForm);
  const [identitySaving, setIdentitySaving] = useState(false);

  const loadIdentities = useCallback(async () => {
    setIdentityLoading(true);
    try {
      const res = await API.get('/api/member-identity/');
      if (res.data.success) setIdentities(res.data.data || []);
    } catch (_) {}
    setIdentityLoading(false);
  }, []);

  const handleIdentitySave = async () => {
    if (!identityForm.name) { showError('名称不能为空'); return; }
    if (!identityForm.package_id) { showError('请选择关联商品'); return; }
    setIdentitySaving(true);
    try {
      const res = identityForm.id
        ? await API.put('/api/member-identity/', identityForm)
        : await API.post('/api/member-identity/', identityForm);
      if (res.data.success) {
        showSuccess(identityForm.id ? '已更新' : '已创建');
        setIdentityModalVisible(false);
        loadIdentities();
      } else showError(res.data.message);
    } catch (_) { showError('保存失败'); }
    setIdentitySaving(false);
  };

  const handleIdentityDelete = (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后已配置该身份的活动/批量发放将无法使用，请确认。',
      onOk: async () => {
        const res = await API.delete(`/api/member-identity/${id}`);
        if (res.data.success) { showSuccess('已删除'); loadIdentities(); }
        else showError(res.data.message);
      },
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/recharge-package/?scope=${scope}`);
      if (res.data.success) setPackages(res.data.data || []);
      else showError(res.data.message);
    } catch (e) {
      showError('加载失败');
    }
    setLoading(false);
  }, [scope]);

  const loadOrders = useCallback(async (page = 1, filters = null) => {
    setOrderLoading(true);
    try {
      const username = filters?.username ?? orderUsername;
      const enterprise = filters?.enterprise ?? orderEnterprise;
      const status = filters?.status ?? orderStatus;
      const params = new URLSearchParams({ page: String(page), page_size: '20' });
      if (username.trim()) params.set('username', username.trim());
      if (enterprise !== 'all') params.set('enterprise', enterprise);
      if (status !== 'all') params.set('status', status);
      const res = await API.get(`/api/payment/admin/orders?${params.toString()}`);
      if (res.data.success) {
        setOrders(res.data.data || []);
        setOrderTotal(res.data.pagination?.total || 0);
        setOrderPage(page);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('加载订单失败');
    }
    setOrderLoading(false);
  }, [orderUsername, orderEnterprise, orderStatus]);

  const loadInvoices = useCallback(async (page = 1, filters = null) => {
    setInvoiceLoading(true);
    try {
      const username = filters?.username ?? invoiceUsername;
      const enterprise = filters?.enterprise ?? invoiceEnterprise;
      const status = filters?.invoice_status ?? invoiceStatus;
      const params = new URLSearchParams({ page: String(page), page_size: '20' });
      if (username.trim()) params.set('username', username.trim());
      if (enterprise !== 'all') params.set('enterprise', enterprise);
      if (status !== 'all') params.set('invoice_status', status);
      const res = await API.get(`/api/invoice/admin/list?${params.toString()}`);
      if (res.data.success) {
        setInvoices(res.data.data || []);
        setInvoiceTotal(res.data.pagination?.total || 0);
        setInvoicePage(page);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('加载发票失败');
    }
    setInvoiceLoading(false);
  }, [invoiceUsername, invoiceEnterprise, invoiceStatus]);

  useEffect(() => {
    if (scope === 'orders') loadOrders(1);
    else if (scope === 'invoices') loadInvoices(1);
    else if (scope === 'identities') loadIdentities();
    else load();
  }, [scope, load, loadOrders, loadInvoices, loadIdentities]);

  const openCreate = () => { setForm({ ...emptyForm, scope }); setShowEdit(true); };
  const openEdit = (record) => { setForm({ ...record }); setShowEdit(true); };

  const handleSave = async () => {
    if (!form.name) { showError('套餐名称不能为空'); return; }
    const payload = { ...form, scope, price: Number(form.price), point: Number(form.point), sort: Number(form.sort) };
    try {
      const res = form.id
        ? await API.put('/api/recharge-package/', payload)
        : await API.post('/api/recharge-package/', payload);
      if (res.data.success) {
        showSuccess(form.id ? '已更新' : '已创建');
        setShowEdit(false);
        load();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('保存失败');
    }
  };

  const handleDelete = (record) => {
    Modal.confirm({
      title: '删除套餐',
      content: `确定删除「${record.name}」？`,
      onOk: async () => {
        const res = await API.delete(`/api/recharge-package/${record.id}`);
        if (res.data.success) { showSuccess('已删除'); load(); }
        else showError(res.data.message);
      },
    });
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '名称', dataIndex: 'name' },
    { title: '积分', dataIndex: 'point', render: (v) => Number(v).toLocaleString() },
    { title: '价格(元)', dataIndex: 'price', render: (v) => (v / 100).toFixed(2) },
    { title: '角标', dataIndex: 'badge', render: (v) => (v ? <Tag color="blue">{v}</Tag> : '-') },
    { title: '排序', dataIndex: 'sort', width: 80 },
    { title: '状态', dataIndex: 'enabled', render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag color="grey">禁用</Tag>) },
    {
      title: '操作',
      render: (t, record) => (
        <Space>
          <Button size="small" theme="solid" type="primary" onClick={() => openEdit(record)}>编辑</Button>
          <Button size="small" type="danger" onClick={() => handleDelete(record)}>删除</Button>
        </Space>
      ),
    },
  ];

  const orderColumns = [
    { title: '订单号', dataIndex: 'order_no', width: 190 },
    {
      title: '用户/企业',
      key: 'user_org',
      render: (text, record) => (
        <div>
          <div>{record.org_id ? (record.org_name || record.username) : record.username}</div>
          <div style={{ color: '#999', fontSize: 12 }}>用户ID: {record.user_id}</div>
        </div>
      ),
    },
    {
      title: '是否企业',
      dataIndex: 'org_id',
      width: 90,
      render: (v) => (v ? <Tag color="blue">企业</Tag> : <Tag color="grey">个人</Tag>),
    },
    { title: '套餐', dataIndex: 'package_name' },
    { title: '金额(元)', dataIndex: 'amount', render: (v) => (Number(v || 0) / 100).toFixed(2) },
    { title: '积分', dataIndex: 'quota', render: (v) => Number(v || 0).toLocaleString() },
    { title: '支付', dataIndex: 'pay_type', render: (v) => (v === 'alipay' ? '支付宝' : '微信') },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v) => (v === 'paid' ? <Tag color="green">已支付</Tag> : <Tag>{v}</Tag>),
    },
    {
      title: '发票',
      dataIndex: 'invoice_status',
      render: (v) => <Tag>{v || 'NONE'}</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', render: (v) => (v ? new Date(v).toLocaleString() : '-') },
  ];

  const invoiceColumns = [
    { title: '发票ID', dataIndex: 'invoice_id', width: 150 },
    { title: '订单号', dataIndex: 'order_no', width: 190 },
    {
      title: '用户/企业',
      key: 'user_org',
      render: (text, record) => (
        <div>
          <div>{record.org_id ? (record.org_name || record.username) : record.username}</div>
          <div style={{ color: '#999', fontSize: 12 }}>用户ID: {record.user_id}</div>
        </div>
      ),
    },
    {
      title: '是否企业',
      dataIndex: 'org_id',
      width: 90,
      render: (v) => (v ? <Tag color="blue">企业</Tag> : <Tag color="grey">个人</Tag>),
    },
    { title: '抬头', dataIndex: 'buyer_name' },
    { title: '税号', dataIndex: 'buyer_tax_num', render: (v) => v || '-' },
    { title: '金额(元)', dataIndex: 'invoice_amount', render: (v) => (Number(v || 0) / 100).toFixed(2) },
    { title: '状态', dataIndex: 'invoice_status', render: (v) => <Tag>{v || 'NONE'}</Tag> },
    {
      title: '发票',
      dataIndex: 'invoice_url',
      render: (v) => (v ? <a href={v} target="_blank" rel="noreferrer">下载</a> : '-'),
    },
    { title: '申请时间', dataIndex: 'apply_time', render: (v) => (v ? new Date(v).toLocaleString() : '-') },
  ];

  const identityColumns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '描述', dataIndex: 'description', render: (v) => v || '-' },
    { title: '关联商品', dataIndex: 'package_id', width: 180, render: (v) => packages.find(p => p.id === v)?.name || `ID:${v}` },
    { title: '套餐等级', dataIndex: 'package_level', width: 100, align: 'center' },
    {
      title: '启用', dataIndex: 'enabled', width: 80, align: 'center',
      render: (v, record) => (
        <Switch checked={v} size="small" onChange={async (checked) => {
          await API.put('/api/member-identity/', { ...record, enabled: checked });
          loadIdentities();
        }} />
      ),
    },
    {
      title: '操作', width: 120,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<Pencil size={14} />} onClick={() => { setIdentityForm({ ...record }); setIdentityModalVisible(true); }} />
          <Button size="small" type="danger" icon={<Trash2 size={14} />} onClick={() => handleIdentityDelete(record.id)} />
        </Space>
      ),
    },
  ];

  const { visibleColumns: packageVisibleColumns, columnConfigButton: packageColumnConfigButton } = useColumnConfig({
    storageKey: 'recharge_package_table_visible_columns',
    columnMeta: [
      { key: 'id', label: 'ID', always: true },
      { key: 'name', label: '名称' },
      { key: 'point', label: '积分' },
      { key: 'price', label: '价格(元)' },
      { key: 'badge', label: '角标' },
      { key: 'sort', label: '排序' },
      { key: 'enabled', label: '状态' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: orderVisibleColumns, columnConfigButton: orderColumnConfigButton } = useColumnConfig({
    storageKey: 'recharge_order_table_visible_columns',
    columnMeta: [
      { key: 'order_no', label: '订单号', always: true },
      { key: 'user_org', label: '用户/企业' },
      { key: 'org_id', label: '是否企业' },
      { key: 'package_name', label: '套餐' },
      { key: 'amount', label: '金额(元)' },
      { key: 'quota', label: '积分' },
      { key: 'pay_type', label: '支付' },
      { key: 'status', label: '状态' },
      { key: 'invoice_status', label: '发票' },
      { key: 'created_at', label: '创建时间' },
    ],
    allColumns: orderColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: invoiceVisibleColumns, columnConfigButton: invoiceColumnConfigButton } = useColumnConfig({
    storageKey: 'recharge_invoice_table_visible_columns',
    columnMeta: [
      { key: 'invoice_id', label: '发票ID', always: true },
      { key: 'order_no', label: '订单号' },
      { key: 'user_org', label: '用户/企业' },
      { key: 'org_id', label: '是否企业' },
      { key: 'buyer_name', label: '抬头' },
      { key: 'buyer_tax_num', label: '税号' },
      { key: 'invoice_amount', label: '金额(元)' },
      { key: 'invoice_status', label: '状态' },
      { key: 'invoice_url', label: '发票' },
      { key: 'apply_time', label: '申请时间' },
    ],
    allColumns: invoiceColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: identityVisibleColumns, columnConfigButton: identityColumnConfigButton } = useColumnConfig({
    storageKey: 'member_identity_table_visible_columns',
    columnMeta: [
      { key: 'name', label: '名称', always: true },
      { key: 'description', label: '描述' },
      { key: 'package_id', label: '关联商品' },
      { key: 'package_level', label: '套餐等级' },
      { key: 'enabled', label: '启用' },
    ],
    allColumns: identityColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>充值套餐管理</Title>
      <ConfigPageTabs activeKey={scope} onChange={setScope} sticky={false} style={{ marginBottom: 12 }}>
        <ConfigPageTabPane tab="企业套餐" itemKey="enterprise" />
        <ConfigPageTabPane tab="个人套餐" itemKey="personal" />
        <ConfigPageTabPane tab="会员身份" itemKey="identities" />
        <ConfigPageTabPane tab="订单列表" itemKey="orders" />
        <ConfigPageTabPane tab="发票管理" itemKey="invoices" />
      </ConfigPageTabs>
      {scope === 'orders' ? (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Input
              placeholder="筛选用户名/企业名"
              value={orderUsername}
              onChange={setOrderUsername}
              onEnterPress={() => loadOrders(1)}
              showClear
              style={{ width: 220 }}
            />
            <Select value={orderEnterprise} onChange={setOrderEnterprise} style={{ width: 140 }}>
              <Select.Option value="all">全部订单</Select.Option>
              <Select.Option value="true">企业订单</Select.Option>
              <Select.Option value="false">个人订单</Select.Option>
            </Select>
            <Select value={orderStatus} onChange={setOrderStatus} style={{ width: 140 }}>
              <Select.Option value="paid">已支付</Select.Option>
              <Select.Option value="all">全部状态</Select.Option>
              <Select.Option value="pending">待支付</Select.Option>
              <Select.Option value="expired">已过期</Select.Option>
              <Select.Option value="cancelled">已取消</Select.Option>
            </Select>
            <Button theme="solid" onClick={() => loadOrders(1)}>筛选</Button>
            <Button onClick={() => {
              setOrderUsername('');
              setOrderEnterprise('all');
              setOrderStatus('paid');
              loadOrders(1, { username: '', enterprise: 'all', status: 'paid' });
            }}>重置</Button>
            {orderColumnConfigButton}
          </Space>
          <Table
            columns={orderVisibleColumns}
            dataSource={orders}
            loading={orderLoading}
            rowKey="order_no"
            pagination={{
              currentPage: orderPage,
              pageSize: 20,
              total: orderTotal,
              onPageChange: (page) => loadOrders(page),
            }}
          />
        </>
      ) : scope === 'invoices' ? (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Input
              placeholder="筛选用户名/企业名/抬头"
              value={invoiceUsername}
              onChange={setInvoiceUsername}
              onEnterPress={() => loadInvoices(1)}
              showClear
              style={{ width: 240 }}
            />
            <Select value={invoiceEnterprise} onChange={setInvoiceEnterprise} style={{ width: 140 }}>
              <Select.Option value="all">全部发票</Select.Option>
              <Select.Option value="true">企业订单</Select.Option>
              <Select.Option value="false">个人订单</Select.Option>
            </Select>
            <Select value={invoiceStatus} onChange={setInvoiceStatus} style={{ width: 140 }}>
              <Select.Option value="all">全部状态</Select.Option>
              <Select.Option value="APPLYING">申请中</Select.Option>
              <Select.Option value="ISSUED">已开票</Select.Option>
              <Select.Option value="FAILED">开票失败</Select.Option>
              <Select.Option value="CANCELED">已取消</Select.Option>
            </Select>
            <Button theme="solid" onClick={() => loadInvoices(1)}>筛选</Button>
            <Button onClick={() => {
              setInvoiceUsername('');
              setInvoiceEnterprise('all');
              setInvoiceStatus('all');
              loadInvoices(1, { username: '', enterprise: 'all', invoice_status: 'all' });
            }}>重置</Button>
            {invoiceColumnConfigButton}
          </Space>
          <Table
            columns={invoiceVisibleColumns}
            dataSource={invoices}
            loading={invoiceLoading}
            rowKey="invoice_id"
            pagination={{
              currentPage: invoicePage,
              pageSize: 20,
              total: invoiceTotal,
              onPageChange: (page) => loadInvoices(page),
            }}
          />
        </>
      ) : (
        <>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button theme="solid" onClick={openCreate}>新建套餐</Button>
            <div style={{ marginLeft: 'auto' }}>{packageColumnConfigButton}</div>
          </div>
          <Table columns={packageVisibleColumns} dataSource={packages} loading={loading} rowKey="id" pagination={false} />
        </>
      )}

      {scope === 'identities' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Button icon={<Plus size={16} />} theme="solid" onClick={() => { setIdentityForm(emptyIdentityForm); setIdentityModalVisible(true); }}>新增身份</Button>
            {identityColumnConfigButton}
          </div>
          <Table
            loading={identityLoading}
            dataSource={identities}
            rowKey="id"
            pagination={false}
            columns={identityVisibleColumns}
          />
          <Modal
            title={identityForm.id ? '编辑会员身份' : '新增会员身份'}
            visible={identityModalVisible}
            onCancel={() => setIdentityModalVisible(false)}
            onOk={handleIdentitySave}
            confirmLoading={identitySaving}
            okText="保存"
            cancelText="取消"
            width={440}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
              <div>
                <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>名称</Text>
                <Input value={identityForm.name} onChange={(v) => setIdentityForm({ ...identityForm, name: v })} placeholder="如：Pro会员、企业版" />
              </div>
              <div>
                <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>描述（可选）</Text>
                <Input value={identityForm.description} onChange={(v) => setIdentityForm({ ...identityForm, description: v })} placeholder="简短说明" />
              </div>
              <div>
                <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>关联商品</Text>
                <Select
                  value={identityForm.package_id}
                  onChange={(v) => {
                    const pkg = packages.find(p => p.id === v);
                    setIdentityForm({ ...identityForm, package_id: v, package_level: pkg?.level ?? 1 });
                  }}
                  style={{ width: '100%' }}
                  placeholder="选择对应的充值套餐"
                  optionList={packages.map(p => ({ value: p.id, label: p.name }))}
                />
              </div>
              <div>
                <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>套餐等级</Text>
                <InputNumber value={identityForm.package_level} onChange={(v) => setIdentityForm({ ...identityForm, package_level: v })} min={0} style={{ width: 120 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: 500 }}>启用</Text>
                <Switch checked={identityForm.enabled} onChange={(v) => setIdentityForm({ ...identityForm, enabled: v })} />
              </div>
            </div>
          </Modal>
        </>
      )}

      <Modal
        title={form.id ? '编辑套餐' : '新建套餐'}
        visible={showEdit}
        onOk={handleSave}
        onCancel={() => setShowEdit(false)}
        okText="保存"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label>套餐名称</label>
            <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></div>
          <div><label>描述</label>
            <Input value={form.description} onChange={(v) => setForm({ ...form, description: v })} /></div>
          <div><label>积分数（到账积分）</label>
            <InputNumber value={form.point} onChange={(v) => setForm({ ...form, point: v })} min={0} style={{ width: '100%' }} /></div>
          <div><label>价格（分，100=1元）</label>
            <InputNumber value={form.price} onChange={(v) => setForm({ ...form, price: v })} min={0} style={{ width: '100%' }} /></div>
          <div><label>角标文字（可选）</label>
            <Input value={form.badge} onChange={(v) => setForm({ ...form, badge: v })} /></div>
          <div><label>排序（小在前）</label>
            <InputNumber value={form.sort} onChange={(v) => setForm({ ...form, sort: v })} style={{ width: '100%' }} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label>启用</label>
            <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default RechargePackages;
