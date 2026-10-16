import React, { useEffect, useState } from 'react';
import { Divider, Form, Grid, Header } from 'semantic-ui-react';
import { Input as SemiInput, Modal, Space, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../helpers';
import { renderQuota } from '../helpers/render';

const expiryOptions = [
  { key: '7', text: '7 天', value: '7' },
  { key: '30', text: '30 天', value: '30' },
  { key: '360', text: '360 天', value: '360' },
  { key: 'never', text: '无限期', value: 'never' },
  { key: 'custom', text: '自定义', value: 'custom' }
];

const batchStatusOptions = [
  { key: 1, text: '已启用用户', value: 1 },
  { key: 0, text: '全部未删除用户', value: 0 },
  { key: 2, text: '已禁用用户', value: 2 }
];

const batchRoleOptions = [
  { key: 0, text: '全部角色', value: 0 },
  { key: 1, text: '普通用户', value: 1 },
  { key: 10, text: '管理员', value: 10 },
  { key: 100, text: '超级管理员', value: 100 }
];

const renderBatchRole = (role) => {
  switch (role) {
    case 1:
      return <Tag>普通用户</Tag>;
    case 10:
      return <Tag color='yellow'>管理员</Tag>;
    case 100:
      return <Tag color='orange'>超级管理员</Tag>;
    default:
      return <Tag color='red'>未知</Tag>;
  }
};

const renderBatchStatus = (status) => {
  switch (status) {
    case 1:
      return <Tag color='green'>已启用</Tag>;
    case 2:
      return <Tag color='red'>已禁用</Tag>;
    default:
      return <Tag>未知</Tag>;
  }
};

const OperationSetting = () => {
  let [inputs, setInputs] = useState({
    ChatLink: '',
    DisplayInCurrencyEnabled: '',
    DisplayTokenStatEnabled: '',
    ApproximateTokenEnabled: ''
  });
  const [originInputs, setOriginInputs] = useState({});
  let [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [batchTimedQuota, setBatchTimedQuota] = useState({
    quota: '',
    expires_mode: '30',
    custom_expires_in_days: '',
    tag: '',
    remark: '',
    keyword: '',
    groups: [],
    status: 1,
    role: 0
  });
  const [batchPreview, setBatchPreview] = useState({ matched: null, users: [] });
  const [batchPreviewLoading, setBatchPreviewLoading] = useState(false);
  const [batchConfirmVisible, setBatchConfirmVisible] = useState(false);
  const [batchAdminPassword, setBatchAdminPassword] = useState('');

  const getOptions = async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (success) {
      let newInputs = {};
      data.forEach((item) => {
        newInputs[item.key] = item.value;
      });
      setInputs(newInputs);
      setOriginInputs(newInputs);
    } else {
      showError(message);
    }
  };

  const getGroups = async () => {
    const res = await API.get('/api/group/');
    const { success, message, data } = res.data;
    if (success) {
      setGroups((data || []).map((group) => ({
        key: group,
        text: group,
        value: group
      })));
    } else {
      showError(message);
    }
  };

  useEffect(() => {
    getOptions().then();
    getGroups().then();
  }, []);

  const updateOption = async (key, value) => {
    setLoading(true);
    if (key.endsWith('Enabled')) {
      value = inputs[key] === 'true' ? 'false' : 'true';
    }
    const res = await API.put('/api/option/', {
      key,
      value
    });
    const { success, message } = res.data;
    if (success) {
      setInputs((inputs) => ({ ...inputs, [key]: value }));
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const handleInputChange = async (e, { name, value }) => {
    if (name.endsWith('Enabled')) {
      await updateOption(name, value);
    } else {
      setInputs((inputs) => ({ ...inputs, [name]: value }));
    }
  };

  const submitConfig = async (group) => {
    switch (group) {
      case 'general':
        if (originInputs['ChatLink'] !== inputs.ChatLink) {
          await updateOption('ChatLink', inputs.ChatLink);
        }
        break;
    }
  };

  const handleBatchTimedQuotaChange = (e, { name, value }) => {
    setBatchTimedQuota((input) => ({ ...input, [name]: value }));
    setBatchPreview({ matched: null, users: [] });
  };

  const getBatchExpiresInDays = () => {
    switch (batchTimedQuota.expires_mode) {
      case '7':
      case '30':
      case '360':
        return Number(batchTimedQuota.expires_mode);
      case 'never':
        return 0;
      case 'custom':
        return Number(batchTimedQuota.custom_expires_in_days || 0);
      default:
        return 30;
    }
  };

  const buildBatchTimedQuotaPayload = (dryRun = false, adminPassword = '') => ({
    quota: Number(batchTimedQuota.quota),
    expires_in_days: getBatchExpiresInDays(),
    tag: batchTimedQuota.tag,
    remark: batchTimedQuota.remark,
    keyword: batchTimedQuota.keyword,
    groups: batchTimedQuota.groups,
    status: Number(batchTimedQuota.status || 0),
    role: Number(batchTimedQuota.role || 0),
    preview_limit: 20,
    dry_run: dryRun,
    admin_password: adminPassword
  });

  const validateBatchTimedQuotaInput = () => {
    const quota = Number(batchTimedQuota.quota);
    const expiresInDays = getBatchExpiresInDays();
    if (!quota || quota <= 0) {
      showError('批量发放额度必须大于 0');
      return false;
    }
    if (expiresInDays < 0) {
      showError('有效期天数不能为负数');
      return false;
    }
    if (batchTimedQuota.expires_mode === 'custom' && (!expiresInDays || expiresInDays <= 0)) {
      showError('自定义有效期天数必须大于 0');
      return false;
    }
    return true;
  };

  const previewBatchTimedQuotaUsers = async () => {
    if (!validateBatchTimedQuotaInput()) return;
    setBatchPreviewLoading(true);
    const res = await API.post('/api/user/timed_quota/batch', buildBatchTimedQuotaPayload(true));
    const { success, message, data } = res.data;
    if (success) {
      setBatchPreview({ matched: data?.matched || 0, users: data?.users || [] });
      showSuccess(`匹配到 ${data?.matched || 0} 个用户`);
    } else {
      showError(message);
    }
    setBatchPreviewLoading(false);
  };

  const openBatchConfirm = async () => {
    if (!validateBatchTimedQuotaInput()) return;
    if (batchPreview.matched === null) {
      await previewBatchTimedQuotaUsers();
    }
    setBatchConfirmVisible(true);
  };

  const submitBatchTimedQuota = async () => {
    if (!batchAdminPassword) {
      showError('请输入管理员密码');
      return;
    }
    setLoading(true);
    const res = await API.post('/api/user/timed_quota/batch', buildBatchTimedQuotaPayload(false, batchAdminPassword));
    const { success, message, data } = res.data;
    if (success) {
      showSuccess(`已为 ${data?.matched || 0} 个用户发放定时积分`);
      setBatchPreview({ matched: data?.matched || 0, users: [] });
      setBatchAdminPassword('');
      setBatchConfirmVisible(false);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const batchPreviewColumns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username', width: 160 },
    { title: '显示名称', dataIndex: 'display_name', width: 160, render: (text) => text || '-' },
    { title: '分组', dataIndex: 'group', width: 120, render: (text) => <Tag>{text || 'default'}</Tag> },
    { title: '状态', dataIndex: 'status', width: 120, render: renderBatchStatus },
    { title: '角色', dataIndex: 'role', width: 120, render: renderBatchRole },
    { title: '当前余额', dataIndex: 'quota', width: 140, render: (quota) => renderQuota(quota || 0) }
  ];

  return (
    <Grid columns={1}>
      <Grid.Column>
        <Form loading={loading}>
          <Header as='h3'>
            通用设置
          </Header>
          <Form.Group widths={2}>
            <Form.Input
              label='聊天页面链接'
              name='ChatLink'
              onChange={handleInputChange}
              autoComplete='new-password'
              value={inputs.ChatLink}
              type='link'
              placeholder='例如 ChatGPT Next Web 的部署地址'
            />
          </Form.Group>
          <Form.Group inline>
            <Form.Checkbox
              checked={inputs.DisplayInCurrencyEnabled === 'true'}
              label='以货币形式显示额度'
              name='DisplayInCurrencyEnabled'
              onChange={handleInputChange}
            />
            <Form.Checkbox
              checked={inputs.DisplayTokenStatEnabled === 'true'}
              label='Billing 相关 API 显示令牌额度而非用户额度'
              name='DisplayTokenStatEnabled'
              onChange={handleInputChange}
            />
            <Form.Checkbox
              checked={inputs.ApproximateTokenEnabled === 'true'}
              label='使用近似的方式估算 token 数以减少计算量'
              name='ApproximateTokenEnabled'
              onChange={handleInputChange}
            />
          </Form.Group>
          <Form.Button onClick={() => {
            submitConfig('general').then();
          }}>保存通用设置</Form.Button>
          <Divider />
          <Header as='h3'>
            运营批量定时积分
          </Header>
          <Form.Group widths={3}>
            <Form.Input
              label='发放额度（积分）'
              name='quota'
              value={batchTimedQuota.quota}
              onChange={handleBatchTimedQuotaChange}
              type='number'
              min='1'
              placeholder='每个用户发放的积分'
            />
            <Form.Select
              label='有效期'
              name='expires_mode'
              options={expiryOptions}
              value={batchTimedQuota.expires_mode}
              onChange={handleBatchTimedQuotaChange}
            />
            <Form.Input
              label='运营标签'
              name='tag'
              value={batchTimedQuota.tag}
              onChange={handleBatchTimedQuotaChange}
              placeholder='例如：新手召回、节日活动'
            />
          </Form.Group>
          {batchTimedQuota.expires_mode === 'custom' && (
            <Form.Group widths={3}>
              <Form.Input
                label='自定义有效期天数'
                name='custom_expires_in_days'
                value={batchTimedQuota.custom_expires_in_days}
                onChange={handleBatchTimedQuotaChange}
                type='number'
                min='1'
                placeholder='请输入大于 0 的天数'
              />
            </Form.Group>
          )}
          <Form.Group widths={2}>
            <Form.Input
              label='用户关键词'
              name='keyword'
              value={batchTimedQuota.keyword}
              onChange={handleBatchTimedQuotaChange}
              placeholder='按用户名、邮箱、显示名或用户 ID 前缀筛选；留空为不限'
            />
            <Form.Dropdown
              label='选择分组'
              name='groups'
              placeholder='不选择则包含所有分组'
              fluid
              multiple
              selection
              clearable
              closeOnChange
              options={groups}
              value={batchTimedQuota.groups}
              onChange={handleBatchTimedQuotaChange}
            />
          </Form.Group>
          <Form.Group widths={3}>
            <Form.Select
              label='用户状态'
              name='status'
              options={batchStatusOptions}
              value={batchTimedQuota.status}
              onChange={handleBatchTimedQuotaChange}
            />
            <Form.Select
              label='用户角色'
              name='role'
              options={batchRoleOptions}
              value={batchTimedQuota.role}
              onChange={handleBatchTimedQuotaChange}
            />
          </Form.Group>
          <Form.TextArea
            label='备注'
            name='remark'
            value={batchTimedQuota.remark}
            onChange={handleBatchTimedQuotaChange}
            placeholder='可选，将写入发放日志'
          />
          <div style={{ marginBottom: 12 }}>
            <Space spacing='medium' wrap>
              <Typography.Text strong>
                匹配用户数：{batchPreview.matched === null ? '未预览' : batchPreview.matched}
              </Typography.Text>
              {batchTimedQuota.groups.length > 0 ? (
                <Space spacing={4} wrap>
                  {batchTimedQuota.groups.map((group) => <Tag key={group}>{group}</Tag>)}
                </Space>
              ) : (
                <Typography.Text type='tertiary'>分组不限</Typography.Text>
              )}
            </Space>
          </div>
          <Table
            size='small'
            columns={batchPreviewColumns}
            dataSource={batchPreview.users}
            pagination={false}
            loading={batchPreviewLoading}
            empty='点击预览后显示前 20 个匹配用户'
            style={{ marginBottom: 16 }}
          />
          <Form.Group>
            <Form.Button type='button' onClick={previewBatchTimedQuotaUsers}>
              预览用户
            </Form.Button>
            <Form.Button
              type='button'
              color='green'
              disabled={batchPreview.matched === 0}
              onClick={openBatchConfirm}
            >
              确认批量发放
            </Form.Button>
          </Form.Group>
          <Modal
            title='确认批量发放'
            visible={batchConfirmVisible}
            onCancel={() => {
              setBatchConfirmVisible(false);
              setBatchAdminPassword('');
            }}
            onOk={submitBatchTimedQuota}
            okText='确认发放'
            cancelText='取消'
            confirmLoading={loading}
          >
            <Space vertical align='start' spacing='medium' style={{ width: '100%' }}>
              <Typography.Text>
                将为 {batchPreview.matched || 0} 个用户每人发放 {Number(batchTimedQuota.quota || 0).toLocaleString()} 积分，
                有效期为 {getBatchExpiresInDays() === 0 ? '无限期' : `${getBatchExpiresInDays()} 天`}。
              </Typography.Text>
              <SemiInput
                mode='password'
                value={batchAdminPassword}
                onChange={setBatchAdminPassword}
                placeholder='请输入管理员密码'
                style={{ width: '100%' }}
              />
            </Space>
          </Modal>
        </Form>
      </Grid.Column>
    </Grid>
  );
};

export default OperationSetting;
