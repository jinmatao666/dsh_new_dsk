import React, { useEffect, useState } from 'react';
import { Button, Table, Tag, Modal, Input, Space, Select, InputNumber } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { renderQuota } from '../../helpers/render';
import { ITEMS_PER_PAGE } from '../../constants';
import { useNavigate } from 'react-router-dom';
import useColumnConfig from '../../hooks/useColumnConfig';

const unitMultipliers = { k: 1000, w: 10000, m: 1000000, b: 1000000000 };
const unitLabels = { k: 'K (千)', w: 'W (万)', m: 'M (百万)', b: 'B (十亿)' };
const unitOptions = Object.keys(unitMultipliers).map((key) => ({ value: key, label: unitLabels[key] }));

const Organization = () => {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);

  const [searchKeyword, setSearchKeyword] = useState('');
  const [searching, setSearching] = useState(false);

  const [topUpOrgId, setTopUpOrgId] = useState(null);
  const [topUpOrgName, setTopUpOrgName] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpUnit, setTopUpUnit] = useState('k');
  const [topUpExpiresInDays, setTopUpExpiresInDays] = useState(0);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showTopUpConfirm, setShowTopUpConfirm] = useState(false);

  const [deleteOrgId, setDeleteOrgId] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const navigate = useNavigate();

  const loadOrgs = async (page) => {
    setLoading(true);
    const res = await API.get(`/api/organization/?p=${page}`);
    const { success, message, data } = res.data;
    if (success) {
      if (page === 0) setOrgs(data || []);
      else setOrgs((prev) => [...prev, ...(data || [])]);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const searchOrgs = async () => {
    if (!searchKeyword.trim()) {
      loadOrgs(0);
      setActivePage(1);
      return;
    }
    setSearching(true);
    setLoading(true);
    const res = await API.get(`/api/organization/search?keyword=${encodeURIComponent(searchKeyword)}`);
    const { success, message, data } = res.data;
    if (success) {
      setOrgs(data || []);
      setActivePage(1);
    } else {
      showError(message);
    }
    setLoading(false);
    setSearching(false);
  };

  useEffect(() => { loadOrgs(0); }, []);

  const getTopUpCredits = () => {
    const amount = Number(topUpAmount);
    if (!amount || isNaN(amount) || amount <= 0) return 0;
    return amount * (unitMultipliers[topUpUnit] || 1000);
  };

  const getTopUpQuota = () => {
    const credits = getTopUpCredits();
    if (credits <= 0) return 0;
    const perUnit = parseFloat(localStorage.getItem('quota_per_unit') || '1000');
    return Math.round(credits * perUnit);
  };

  const handleTopUpSubmit = () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) {
      showError('请输入有效的充值数量');
      return;
    }
    setShowTopUp(false);
    setShowTopUpConfirm(true);
  };

  const handleTopUpConfirm = async () => {
    const quota = getTopUpQuota();
    const payload = { quota };
    if (topUpExpiresInDays > 0) {
      payload.expires_in_days = Number(topUpExpiresInDays);
    }
    const res = await API.post(`/api/organization/${topUpOrgId}/topup`, payload);
    if (res.data.success) {
      showSuccess('充值成功');
      setShowTopUpConfirm(false);
      setTopUpAmount('');
      setTopUpUnit('k');
      setTopUpExpiresInDays(0);
      loadOrgs(0);
    } else {
      showError(res.data.message);
    }
  };

  const handleDelete = async () => {
    if (!deletePassword) {
      showError('请输入管理员密码');
      return;
    }
    const res = await API.post(`/api/organization/${deleteOrgId}/delete`, { password: deletePassword });
    if (res.data.success) {
      showSuccess('删除成功');
      setShowDelete(false);
      setDeletePassword('');
      loadOrgs(0);
    } else {
      showError(res.data.message);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id' },
    {
      title: '名称',
      dataIndex: 'name',
      render: (text, record) => (
        <a onClick={() => navigate(`/organization/${record.id}`)} style={{ cursor: 'pointer' }}>{text}</a>
      ),
    },
    { title: '编码', dataIndex: 'code' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v) => v === 1 ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag>,
    },
    { title: '分组', dataIndex: 'group', render: (v) => <Tag>{v}</Tag> },
    { title: '有效总额', dataIndex: 'valid_total', render: (v) => renderQuota(v || 0) },
    { title: '可用', dataIndex: 'available', render: (v) => renderQuota(v || 0) },
    { title: '已用', dataIndex: 'used', render: (v) => renderQuota(v || 0) },
    { title: '成员上限', dataIndex: 'max_members' },
    {
      title: '操作',
      render: (text, record) => (
        <Space>
          <Button
            size="small"
            theme="solid"
            type="warning"
            onClick={() => {
              setTopUpOrgId(record.id);
              setTopUpOrgName(record.name);
              setTopUpAmount('');
              setTopUpUnit('k');
              setShowTopUp(true);
            }}
          >
            充值
          </Button>
          <Button
            size="small"
            theme="solid"
            type="primary"
            onClick={() => navigate(`/organization/${record.id}`)}
          >
            设置
          </Button>
          <Button
            size="small"
            type="danger"
            onClick={() => {
              setDeleteOrgId(record.id);
              setDeletePassword('');
              setShowDelete(true);
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'organization_table_visible_columns_v2',
    columnMeta: [
      { key: 'id', label: 'ID', always: true },
      { key: 'name', label: '名称' },
      { key: 'code', label: '编码' },
      { key: 'status', label: '状态' },
      { key: 'group', label: '分组' },
      { key: 'valid_total', label: '有效总额' },
      { key: 'available', label: '可用' },
      { key: 'used', label: '已用' },
      { key: 'max_members', label: '成员上限' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Input
            prefix={<IconSearch />}
            placeholder="搜索企业名称或编码..."
            value={searchKeyword}
            onChange={setSearchKeyword}
            onEnterPress={searchOrgs}
            showClear
            style={{ width: 280 }}
          />
        </Space>
        <Space>
          {columnConfigButton}
          <Button theme="solid" onClick={() => navigate('/organization/create')}>创建企业</Button>
          <Button onClick={() => { loadOrgs(0); setActivePage(1); }}>刷新</Button>
        </Space>
      </Space>

      <Table
        columns={visibleColumns}
        dataSource={orgs}
        loading={loading}
        pagination={{
          currentPage: activePage,
          pageSize: ITEMS_PER_PAGE,
          total: orgs.length,
          onPageChange: (page) => setActivePage(page),
        }}
        rowKey="id"
      />

      {/* Top-up Modal (step 1) */}
      <Modal
        title="企业充值"
        visible={showTopUp}
        onOk={handleTopUpSubmit}
        onCancel={() => setShowTopUp(false)}
        okText="下一步"
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <InputNumber
            style={{ flex: 1 }}
            placeholder="输入充值数量"
            value={topUpAmount}
            onChange={setTopUpAmount}
            min={0}
          />
          <Select
            value={topUpUnit}
            onChange={setTopUpUnit}
            optionList={unitOptions}
            style={{ width: 120 }}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, color: '#666' }}>有效期（天，0 = 永久）</label>
          <InputNumber
            style={{ width: '100%', marginTop: 4 }}
            placeholder="不填或填 0 表示永久有效"
            value={topUpExpiresInDays}
            onChange={setTopUpExpiresInDays}
            min={0}
          />
        </div>
        {topUpAmount > 0 && (
          <p style={{ marginTop: 10, color: '#666' }}>
            充值 {Number(topUpAmount).toLocaleString()} {unitLabels[topUpUnit]} = {getTopUpCredits().toLocaleString()} 积分
            {topUpExpiresInDays > 0 ? `，${topUpExpiresInDays} 天后过期` : '，永久有效'}
          </p>
        )}
      </Modal>

      {/* Top-up Confirm Modal (step 2) */}
      <Modal
        title="确认充值"
        visible={showTopUpConfirm}
        onOk={handleTopUpConfirm}
        onCancel={() => { setShowTopUpConfirm(false); setShowTopUp(true); }}
        okText="确认充值"
        cancelText="返回修改"
      >
        <p><strong>企业：</strong>{topUpOrgName}</p>
        <p><strong>充值额度：</strong>{getTopUpCredits().toLocaleString()} 积分</p>
        <p><strong>有效期：</strong>{topUpExpiresInDays > 0 ? `${topUpExpiresInDays} 天后过期` : '永久'}</p>
        <p><strong>内部 quota：</strong>{getTopUpQuota().toLocaleString()}</p>
        <p style={{ color: '#999', fontSize: 12 }}>确认后将立即生效，请核实充值信息。</p>
      </Modal>

      {/* Delete Modal */}
      <Modal
        title="删除企业"
        visible={showDelete}
        onOk={handleDelete}
        onCancel={() => { setShowDelete(false); setDeletePassword(''); }}
        okText="确认删除"
        okButtonProps={{ type: 'danger' }}
      >
        <p>此操作不可撤销，请输入管理员密码确认：</p>
        <Input type="password" placeholder="管理员密码" value={deletePassword} onChange={setDeletePassword} />
      </Modal>

    </div>
  );
};

export default Organization;
