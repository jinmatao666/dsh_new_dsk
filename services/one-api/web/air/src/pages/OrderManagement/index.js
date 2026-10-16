import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Space, Table, Tag } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../helpers';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';
import useColumnConfig from '../../hooks/useColumnConfig';
import { renderQuota } from '../../helpers/render';

const INVOICE_STATUS_MAP = {
  NONE: { text: '未开票', color: 'grey' },
  NOT_APPLIED: { text: '未申请', color: 'grey' },
  APPLYING: { text: '申请中', color: 'amber' },
  ISSUED: { text: '已开票', color: 'green' },
  FAILED: { text: '开票失败', color: 'red' },
  CANCELED: { text: '已取消', color: 'grey' },
  CANCELLED: { text: '已取消', color: 'grey' },
};

const renderInvoiceStatusTag = (v) => {
  const key = String(v || 'NONE').toUpperCase();
  const s = INVOICE_STATUS_MAP[key] || { text: '未开票', color: 'grey' };
  return <Tag color={s.color}>{s.text}</Tag>;
};

const OrderManagement = () => {
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
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

  // 改单记录
  const [changeLogs, setChangeLogs] = useState([]);
  const [changeLogLoading, setChangeLogLoading] = useState(false);
  const [changeLogKeyword, setChangeLogKeyword] = useState('');

  // 改单弹窗
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeRecord, setChangeRecord] = useState(null);
  const [changePackages, setChangePackages] = useState([]);
  const [changeTargetId, setChangeTargetId] = useState(null);
  const [changePreview, setChangePreview] = useState(null);
  const [changePreviewing, setChangePreviewing] = useState(false);
  const [changeSubmitting, setChangeSubmitting] = useState(false);

  const loadOrders = useCallback(async (page = 1, filters = null) => {
    setOrderLoading(true);
    try {
      const username = filters?.username ?? orderUsername;
      const enterprise = filters?.enterprise ?? orderEnterprise;
      const status = filters?.status ?? orderStatus;
      const params = new URLSearchParams({ page: String(page), page_size: '20' });
      if (username.trim()) params.set('username', username.trim());
      if (enterprise !== 'all') params.set('enterprise', enterprise);
      // 后端 AdminListPaymentOrders 不传 status 时默认 paid，故"全部状态"须显式传 all
      params.set('status', status);
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
  }, [orderEnterprise, orderStatus, orderUsername]);

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
  }, [invoiceEnterprise, invoiceStatus, invoiceUsername]);

  const loadChangeLogs = useCallback(async (keyword = null) => {
    setChangeLogLoading(true);
    try {
      const kw = keyword ?? changeLogKeyword;
      const url = kw.trim()
        ? `/api/payment/admin/orders/change-logs/search?keyword=${encodeURIComponent(kw.trim())}`
        : '/api/payment/admin/orders/change-logs?page=1';
      const res = await API.get(url);
      if (res.data.success) {
        setChangeLogs(res.data.data || []);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('加载改单记录失败');
    }
    setChangeLogLoading(false);
  }, [changeLogKeyword]);

  useEffect(() => {
    if (tab === 'orders') loadOrders(1);
    if (tab === 'invoices') loadInvoices(1);
    if (tab === 'change_logs') loadChangeLogs();
  }, [tab, loadOrders, loadInvoices, loadChangeLogs]);

  const openChangeModal = useCallback(async (record) => {
    setChangeRecord(record);
    setChangeTargetId(null);
    setChangePreview(null);
    setChangePackages([]);
    setChangeOpen(true);
    try {
      const res = await API.get(`/api/payment/admin/orders/changeable-packages?order_no=${encodeURIComponent(record.order_no)}`);
      if (res.data.success) {
        setChangePackages(res.data.data || []);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('加载可选套餐失败');
    }
  }, []);

  const handleSelectTarget = useCallback(async (value) => {
    setChangeTargetId(value);
    setChangePreview(null);
    if (!value || !changeRecord) return;
    setChangePreviewing(true);
    try {
      const res = await API.post('/api/payment/admin/orders/change/preview', {
        order_no: changeRecord.order_no,
        target_package_id: value,
      });
      if (res.data.success) {
        setChangePreview(res.data.data);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('预览改单失败');
    }
    setChangePreviewing(false);
  }, [changeRecord]);

  const handleChangeSubmit = useCallback(async () => {
    if (!changeTargetId || !changeRecord) return;
    setChangeSubmitting(true);
    try {
      const res = await API.post('/api/payment/admin/orders/change', {
        order_no: changeRecord.order_no,
        target_package_id: changeTargetId,
      });
      if (res.data.success) {
        showSuccess('改单成功');
        setChangeOpen(false);
        loadOrders(orderPage);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('改单失败');
    }
    setChangeSubmitting(false);
  }, [changeTargetId, changeRecord, loadOrders, orderPage]);

  const handleRefund = useCallback((record) => {
    const quotaText = renderQuota(record.quota || 0);
    Modal.confirm({
      title: '订单退积分',
      content: (
        <div style={{ lineHeight: 1.7 }}>
          <div>订单号：{record.order_no}</div>
          <div>退回积分：{quotaText}</div>
          <div style={{ color: '#FF3B30', marginTop: 8 }}>
            将从用户/企业账户扣回该订单积分（剩余积分不会被扣成负数）。现金退款请由财务另行处理。此操作不可撤销。
          </div>
        </div>
      ),
      okText: '确认退积分',
      cancelText: '取消',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        try {
          const res = await API.post('/api/payment/admin/orders/refund', { order_no: record.order_no });
          if (res.data.success) {
            showSuccess(`退积分成功，实退 ${renderQuota(res.data.data?.refunded_quota || 0)} 积分`);
            loadOrders(orderPage);
          } else {
            showError(res.data.message);
          }
        } catch (e) {
          showError('退积分失败');
        }
      },
    });
  }, [loadOrders, orderPage]);

  const orderColumns = [
    { title: '订单号', dataIndex: 'order_no', width: 190 },
    {
      title: '用户/企业',
      key: 'user_org',
      render: (_, record) => (
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
    { title: '商品', dataIndex: 'package_name' },
    { title: '金额(元)', dataIndex: 'amount', render: (v) => (Number(v || 0) / 100).toFixed(2) },
    { title: '积分', dataIndex: 'quota', render: (v) => renderQuota(v || 0) },
    { title: '支付', dataIndex: 'pay_type', render: (v) => (v === 'alipay' ? '支付宝' : '微信') },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v) => {
        const key = String(v || '').toLowerCase();
        const map = {
          paid: { text: '已支付', color: 'green' },
          success: { text: '已完成', color: 'green' },
          pending: { text: '待支付', color: 'amber' },
          refunded: { text: '已退积分', color: 'orange' },
          cancelled: { text: '已取消', color: 'grey' },
          canceled: { text: '已取消', color: 'grey' },
          cancel: { text: '已取消', color: 'grey' },
          expired: { text: '已过期', color: 'grey' },
          failed: { text: '支付失败', color: 'red' },
        };
        const s = map[key];
        return s ? <Tag color={s.color}>{s.text}</Tag> : <Tag>{v || '-'}</Tag>;
      },
    },
    { title: '发票', dataIndex: 'invoice_status', render: (v) => renderInvoiceStatusTag(v) },
    { title: '创建时间', dataIndex: 'created_at', render: (v) => (v ? new Date(v).toLocaleString() : '-') },
    {
      title: '操作',
      width: 150,
      render: (_, record) =>
        record.status === 'paid' ? (
          <Space spacing={4}>
            {!record.org_id && (
              <Button theme="borderless" type="primary" size="small" onClick={() => openChangeModal(record)}>
                改单
              </Button>
            )}
            <Button theme="borderless" type="danger" size="small" onClick={() => handleRefund(record)}>
              退积分
            </Button>
          </Space>
        ) : null,
    },
  ];

  const invoiceColumns = [
    { title: '发票ID', dataIndex: 'invoice_id', width: 150 },
    { title: '订单号', dataIndex: 'order_no', width: 190 },
    {
      title: '用户/企业',
      key: 'user_org',
      render: (_, record) => (
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
    { title: '状态', dataIndex: 'invoice_status', render: (v) => renderInvoiceStatusTag(v) },
    { title: '发票', dataIndex: 'invoice_url', render: (v) => (v ? <a href={v} target="_blank" rel="noreferrer">下载</a> : '-') },
    { title: '申请时间', dataIndex: 'apply_time', render: (v) => (v ? new Date(v).toLocaleString() : '-') },
  ];

  const { visibleColumns: orderVisibleColumns, columnConfigButton: orderColumnConfigButton } = useColumnConfig({
    storageKey: 'order_table_visible_columns',
    columnMeta: [
      { key: 'order_no', label: '订单号', always: true },
      { key: 'user_org', label: '用户/企业' },
      { key: 'org_id', label: '是否企业' },
      { key: 'package_name', label: '商品' },
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
    storageKey: 'invoice_table_visible_columns',
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

  const changeLogColumns = [
    { title: '订单号', dataIndex: 'order_no', width: 190 },
    {
      title: '用户/企业',
      key: 'user_org',
      render: (_, record) => (
        <div>
          <div>{record.org_id ? (record.org_name || record.username) : record.username}</div>
          <div style={{ color: '#999', fontSize: 12 }}>用户ID: {record.user_id}</div>
        </div>
      ),
    },
    {
      title: '套餐变更',
      key: 'pkg_change',
      render: (_, record) => `${record.from_package} → ${record.to_package}`,
    },
    { title: '已用积分', dataIndex: 'used_quota', render: (v) => renderQuota(v || 0) },
    {
      title: '积分变动',
      dataIndex: 'delta_quota',
      render: (v) => (
        <span style={{ color: Number(v) >= 0 ? '#34C759' : '#FF3B30' }}>
          {Number(v) >= 0 ? '+' : '-'}
          {renderQuota(Math.abs(Number(v || 0)))}
        </span>
      ),
    },
    {
      title: '建议退款(元)',
      dataIndex: 'refund_amount',
      render: (v) => (
        <Tag color={Number(v) > 0 ? 'orange' : 'grey'}>{(Number(v || 0) / 100).toFixed(2)}</Tag>
      ),
    },
    { title: '操作人', dataIndex: 'operator_name', render: (v) => v || '-' },
    { title: '改单时间', dataIndex: 'created_at', render: (v) => (v ? new Date(v).toLocaleString() : '-') },
  ];

  const renderQuotaCents = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;

  const cycleLabel = (c) => (c === 'yearly' ? '年付' : c === 'monthly' ? '月付' : c || '-');

  return (
    <div style={{ padding: 0 }}>
      <ConfigPageTabs activeKey={tab} onChange={setTab} style={{ marginBottom: 12 }}>
        <ConfigPageTabPane tab="订单列表" itemKey="orders" />
        <ConfigPageTabPane tab="发票管理" itemKey="invoices" />
        <ConfigPageTabPane tab="改单记录" itemKey="change_logs" />
      </ConfigPageTabs>
      {tab === 'orders' ? (
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
              <Select.Option value="refunded">已退积分</Select.Option>
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
      ) : tab === 'invoices' ? (
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
          <Space style={{ marginBottom: 12 }}>
            <Input
              placeholder="搜索订单号/用户名/企业名"
              value={changeLogKeyword}
              onChange={setChangeLogKeyword}
              onEnterPress={() => loadChangeLogs()}
              showClear
              style={{ width: 260 }}
            />
            <Button theme="solid" onClick={() => loadChangeLogs()}>搜索</Button>
            <Button onClick={() => { setChangeLogKeyword(''); loadChangeLogs(''); }}>重置</Button>
          </Space>
          <Table
            columns={changeLogColumns}
            dataSource={changeLogs}
            loading={changeLogLoading}
            rowKey="id"
            pagination={false}
          />
        </>
      )}

      <Modal
        title="修改订单（转换套餐）"
        visible={changeOpen}
        onCancel={() => setChangeOpen(false)}
        onOk={handleChangeSubmit}
        okText="确认改单"
        cancelText="取消"
        okButtonProps={{ disabled: !changePreview || changePreviewing || changeSubmitting, loading: changeSubmitting }}
      >
        {changeRecord && (
          <div style={{ lineHeight: 1.8 }}>
            <div style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
              保留已使用积分，转换后剩余=目标套餐积分−已用（不小于0）。建议退款=原订单实付−目标套餐价，现金请由财务线下处理。
            </div>
            <div>订单号：{changeRecord.order_no}</div>
            <div>原套餐：{changeRecord.package_name}（{renderQuotaCents(changeRecord.amount)}）</div>
            <div style={{ marginTop: 12 }}>
              <span style={{ marginRight: 8 }}>目标套餐：</span>
              <Select
                style={{ width: 280 }}
                value={changeTargetId}
                onChange={handleSelectTarget}
                placeholder="选择目标套餐"
                loading={changePreviewing}
              >
                {changePackages.map((p) => (
                  <Select.Option key={p.id} value={p.id}>
                    {p.name}（{renderQuotaCents(p.price)} / {renderQuota(p.quota)}积分）
                  </Select.Option>
                ))}
              </Select>
            </div>
            {changePreview && (
              <Table
                style={{ marginTop: 16 }}
                pagination={false}
                showHeader={false}
                size="small"
                rowKey="k"
                columns={[
                  { dataIndex: 'k', width: 130 },
                  { dataIndex: 'v', render: (v, r) => <span style={r.style}>{v}</span> },
                ]}
                dataSource={[
                  { k: '目标套餐', v: `${changePreview.to_package}（${renderQuotaCents(changePreview.new_amount)}）` },
                  ...(changePreview.from_cycle !== changePreview.to_cycle && !changePreview.is_org
                    ? [{
                        k: '订阅周期',
                        v: `${cycleLabel(changePreview.from_cycle)} → ${cycleLabel(changePreview.to_cycle)}`,
                        style: { color: '#FF9F0A' },
                      }]
                    : []),
                  { k: '已使用积分', v: renderQuota(changePreview.used || 0) },
                  { k: '转换后剩余积分', v: renderQuota(changePreview.new_remaining || 0) },
                  {
                    k: '余额变动',
                    v: `${changePreview.delta_quota >= 0 ? '+' : '-'}${renderQuota(Math.abs(Number(changePreview.delta_quota || 0)))}`,
                    style: { color: changePreview.delta_quota >= 0 ? '#34C759' : '#FF3B30' },
                  },
                  { k: '建议退款', v: renderQuotaCents(changePreview.refund_amount) },
                ]}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default OrderManagement;
