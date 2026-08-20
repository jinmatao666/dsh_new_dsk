import React, { useEffect, useState } from 'react';
import { Banner, Button, Card, Input, Space, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../helpers';
import { renderQuota } from '../../helpers/render';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Title } = Typography;

const MyOrganizations = () => {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentOrgId, setCurrentOrgId] = useState(null);
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);

  const loadOrgs = async () => {
    const res = await API.get('/api/organization/my');
    if (res.data.success) setOrgs(res.data.data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadOrgs();
    const user = localStorage.getItem('user');
    if (user) {
      const data = JSON.parse(user);
      setCurrentOrgId(data.current_org_id || null);
    }
  }, []);

  const handleSwitch = async (orgId) => {
    const res = await API.post('/api/organization/switch', { org_id: orgId });
    if (res.data.success) {
      showSuccess(orgId ? '已切换到企业模式' : '已切换到个人模式');
      setCurrentOrgId(orgId);
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      user.current_org_id = orgId;
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      showError(res.data.message);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode) { showError('请输入邀请码'); return; }
    setJoining(true);
    const res = await API.post('/api/organization/join', { invite_code: inviteCode });
    if (res.data.success) { showSuccess('加入成功'); setInviteCode(''); loadOrgs(); }
    else showError(res.data.message);
    setJoining(false);
  };

  const columns = [
    { title: '企业名称', dataIndex: 'name', render: (text, record) => (
      <span>{text} {currentOrgId === record.id && <Tag color="blue" size="small">当前</Tag>}</span>
    )},
    { title: '编码', dataIndex: 'code' },
    { title: '额度', dataIndex: 'quota', render: (v) => renderQuota(v) },
    { title: '状态', dataIndex: 'status', render: (v) => v === 1 ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag> },
    { title: '操作', render: (text, record) => (
      currentOrgId !== record.id
        ? <Button size="small" theme="solid" onClick={() => handleSwitch(record.id)}>切换到此企业</Button>
        : <Button size="small" onClick={() => handleSwitch(null)}>切回个人</Button>
    )},
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'myorganizations_table_visible_columns',
    columnMeta: [
      { key: 'name', label: '企业名称', always: true },
      { key: 'code', label: '编码' },
      { key: 'quota', label: '额度' },
      { key: 'status', label: '状态' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>我的企业</Title>

      {currentOrgId && (
        <Banner type="info" description="当前处于企业模式，API 请求将从企业额度池扣减。"
          closeIcon={null}
          style={{ marginBottom: 16 }}
        >
          <Button size="small" onClick={() => handleSwitch(null)}>切回个人模式</Button>
        </Banner>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          {columnConfigButton}
        </div>
        <Table columns={visibleColumns} dataSource={orgs} loading={loading} rowKey="id" pagination={false} empty="你还没有加入任何企业" />
      </Card>

      <Card title="使用邀请码加入企业">
        <Space>
          <Input placeholder="输入邀请码" value={inviteCode} onChange={setInviteCode} style={{ width: 250 }} />
          <Button theme="solid" onClick={handleJoin} loading={joining}>加入</Button>
        </Space>
      </Card>
    </div>
  );
};

export default MyOrganizations;
