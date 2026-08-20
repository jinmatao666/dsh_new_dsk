import React, { useEffect, useState } from 'react';
import { API, isMobile, showError, showSuccess } from '../../helpers';
import { renderQuotaWithPrompt, getQuotaPerUnit } from '../../helpers/render';
import Title from '@douyinfe/semi-ui/lib/es/typography/title';
import { Button, Divider, Input, Modal, Select, SideSheet, Space, Spin, Typography } from '@douyinfe/semi-ui';

const EditUser = (props) => {
  const userId = props.editingUser.id;
  const [loading, setLoading] = useState(true);
  const [inputs, setInputs] = useState({
    username: '',
    display_name: '',
    password: '',
    admin_password: '',
    github_id: '',
    wechat_id: '',
    email: '',
    phone: '',
    quota: 0,
    group: 'default'
  });
  const [topUpInputs, setTopUpInputs] = useState({
    quota: '',
    remark: '',
    expires_in_days: 0,
    custom_expires_in_days: '',
    admin_password: ''
  });
  const [originInputs, setOriginInputs] = useState(null);
  const [adminPasswordModalVisible, setAdminPasswordModalVisible] = useState(false);
  const [pendingProfilePayload, setPendingProfilePayload] = useState(null);
  const [profileAdminPassword, setProfileAdminPassword] = useState('');
  const [groupOptions, setGroupOptions] = useState([]);
  const { username, display_name, password, github_id, wechat_id, telegram_id, email, phone, group } =
    inputs;
  const handleInputChange = (name, value) => {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };
  const handleTopUpInputChange = (name, value) => {
    setTopUpInputs((inputs) => ({ ...inputs, [name]: value }));
  };
  const fetchGroups = async () => {
    try {
      let res = await API.get(`/api/group/`);
      setGroupOptions(res.data.data.map((group) => ({
        label: group,
        value: group
      })));
    } catch (error) {
      showError(error.message);
    }
  };
  const handleCancel = () => {
    props.handleClose();
  };
  const loadUser = async () => {
    setLoading(true);
    let res = undefined;
    if (userId) {
      res = await API.get(`/api/user/${userId}`);
    } else {
      res = await API.get(`/api/user/self`);
    }
    const { success, message, data } = res.data;
    if (success) {
      data.password = '';
      setOriginInputs(data);
      setInputs(data);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadUser().then();
    if (userId) {
      fetchGroups().then();
    }
  }, [props.editingUser.id]);

  const submit = async () => {
    let res = undefined;
    if (userId) {
      let data = {
        id: parseInt(userId),
        username,
        display_name,
        password,
        phone,
        group
      };
      const sensitiveChanged = originInputs && (
        originInputs.username !== username ||
        originInputs.display_name !== display_name ||
        (originInputs.phone || '') !== (phone || '') ||
        !!password
      );
      if (sensitiveChanged) {
        setPendingProfilePayload(data);
        setProfileAdminPassword('');
        setAdminPasswordModalVisible(true);
        return;
      }
      setLoading(true);
      res = await API.put(`/api/user/`, data);
    } else {
      setLoading(true);
      res = await API.put(`/api/user/self`, inputs);
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess('用户信息更新成功！');
      props.refresh();
      props.handleClose();
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const submitProfilePayload = async (payload) => {
    setLoading(true);
    const res = await API.put(`/api/user/`, payload);
    const { success, message } = res.data;
    if (success) {
      showSuccess('用户信息更新成功！');
      setAdminPasswordModalVisible(false);
      setPendingProfilePayload(null);
      setProfileAdminPassword('');
      props.refresh();
      props.handleClose();
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const submitProfileWithPassword = async () => {
    if (!profileAdminPassword) {
      showError('请输入管理员密码');
      return;
    }
    await submitProfilePayload({
      ...pendingProfilePayload,
      admin_password: profileAdminPassword
    });
  };

  const submitTopUp = async () => {
    const pointsValue = parseFloat(topUpInputs.quota);
    if (!pointsValue || pointsValue <= 0) {
      showError('请输入大于 0 的积分额度');
      return;
    }
    // 输入为积分，发放到后端需换算为 token 额度
    const quotaValue = Math.round(pointsValue * getQuotaPerUnit());
    if (!topUpInputs.admin_password) {
      showError('请输入管理员密码');
      return;
    }
    let expiresInDays = parseInt(topUpInputs.expires_in_days || 0);
    if (expiresInDays === -1) {
      expiresInDays = parseInt(topUpInputs.custom_expires_in_days || 0);
      if (!expiresInDays || expiresInDays <= 0) {
        showError('请输入大于 0 的自定义有效天数');
        return;
      }
    }
    setLoading(true);
    const res = await API.post('/api/topup', {
      user_id: parseInt(userId),
      quota: quotaValue,
      remark: topUpInputs.remark,
      expires_in_days: expiresInDays,
      admin_password: topUpInputs.admin_password
    });
    const { success, message } = res.data;
    if (success) {
      showSuccess('积分已发放');
      setTopUpInputs({
        quota: '',
        remark: '',
        expires_in_days: 0,
        custom_expires_in_days: '',
        admin_password: ''
      });
      await loadUser();
      props.refresh();
    } else {
      showError(message);
    }
    setLoading(false);
  };

  return (
    <>
      <Modal
        title="管理员密码验证"
        visible={adminPasswordModalVisible}
        onOk={submitProfileWithPassword}
        onCancel={() => {
          setAdminPasswordModalVisible(false);
          setPendingProfilePayload(null);
          setProfileAdminPassword('');
        }}
        okText="确认提交"
        cancelText="取消"
      >
        <Typography.Text>修改用户名、密码、显示名称或手机号需要验证管理员密码。</Typography.Text>
        <Input
          style={{ marginTop: 16 }}
          type="password"
          placeholder="请输入管理员密码"
          value={profileAdminPassword}
          onChange={setProfileAdminPassword}
          autoComplete="new-password"
        />
      </Modal>
      <SideSheet
        placement={'right'}
        title={<Title level={3}>{'编辑用户'}</Title>}
        headerStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
        bodyStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
        visible={props.visible}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Space>
              <Button theme="solid" size={'large'} onClick={submit}>提交</Button>
              <Button theme="solid" size={'large'} type={'tertiary'} onClick={handleCancel}>取消</Button>
            </Space>
          </div>
        }
        closeIcon={null}
        onCancel={() => handleCancel()}
        width={isMobile() ? '100%' : 600}
      >
        <Spin spinning={loading}>
          <div style={{ marginTop: 20 }}>
            <Typography.Text>用户名</Typography.Text>
          </div>
          <Input
            label="用户名"
            name="username"
            placeholder={'请输入新的用户名'}
            onChange={value => handleInputChange('username', value)}
            value={username}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 20 }}>
            <Typography.Text>密码</Typography.Text>
          </div>
          <Input
            label="密码"
            name="password"
            type={'password'}
            placeholder={'请输入新的密码，最短 8 位'}
            onChange={value => handleInputChange('password', value)}
            value={password}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 20 }}>
            <Typography.Text>显示名称</Typography.Text>
          </div>
          <Input
            label="显示名称"
            name="display_name"
            placeholder={'请输入新的显示名称'}
            onChange={value => handleInputChange('display_name', value)}
            value={display_name}
            autoComplete="new-password"
          />
          {
            userId && <>
              <div style={{ marginTop: 20 }}>
                <Typography.Text>分组</Typography.Text>
              </div>
              <Select
                placeholder={'请选择分组'}
                name="group"
                fluid
                search
                selection
                allowAdditions
                additionLabel={'请在系统设置页面编辑分组倍率以添加新的分组：'}
                onChange={value => handleInputChange('group', value)}
                value={inputs.group}
                autoComplete="new-password"
                optionList={groupOptions}
              />
              <div style={{ marginTop: 20 }}>
                <Typography.Text>手机号</Typography.Text>
              </div>
              <Input
                name="phone"
                placeholder={'输入手机号绑定/换绑，留空并提交则解绑；管理员绑定将直接标记为已验证'}
                onChange={value => handleInputChange('phone', value)}
                value={phone}
                autoComplete="new-password"
              />
              <div style={{ marginTop: 20 }}>
                <Typography.Text>{`剩余额度${renderQuotaWithPrompt((inputs.subscription_quota ?? 0) + (inputs.timed_quota_total ?? 0))}`}</Typography.Text>
                <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                  {`订阅积分${renderQuotaWithPrompt(inputs.subscription_quota ?? 0)} / 定时积分${renderQuotaWithPrompt(inputs.timed_quota_total ?? 0)}`}
                </div>
              </div>
              <Divider style={{ marginTop: 20 }}>积分操作</Divider>
              <div style={{ marginTop: 20 }}>
                <Typography.Text>加积分（单位：积分）</Typography.Text>
              </div>
              <Input
                name="topup_quota"
                placeholder={'输入本次新增积分数量'}
                onChange={value => handleTopUpInputChange('quota', value)}
                value={topUpInputs.quota}
                type={'number'}
                suffix={'积分'}
                autoComplete="new-password"
              />
              <div style={{ marginTop: 20 }}>
                <Typography.Text>有效期</Typography.Text>
              </div>
              <Select
                name="expires_in_days"
                value={topUpInputs.expires_in_days}
                onChange={value => handleTopUpInputChange('expires_in_days', value)}
                optionList={[
                  { label: '永久', value: 0 },
                  { label: '7 天', value: 7 },
                  { label: '30 天', value: 30 },
                  { label: '90 天', value: 90 },
                  { label: '自定义天数', value: -1 }
                ]}
                style={{ width: 180 }}
              />
              {topUpInputs.expires_in_days === -1 && (
                <Input
                  style={{ marginTop: 12 }}
                  name="custom_expires_in_days"
                  placeholder={'输入有效天数'}
                  onChange={value => handleTopUpInputChange('custom_expires_in_days', value)}
                  value={topUpInputs.custom_expires_in_days}
                  type={'number'}
                  autoComplete="new-password"
                />
              )}
              <div style={{ marginTop: 20 }}>
                <Typography.Text>备注</Typography.Text>
              </div>
              <Input
                name="topup_remark"
                placeholder={'可选，记录在积分账本来源中'}
                onChange={value => handleTopUpInputChange('remark', value)}
                value={topUpInputs.remark}
                autoComplete="new-password"
              />
              <div style={{ marginTop: 20 }}>
                <Typography.Text>管理员密码</Typography.Text>
              </div>
              <Input
                name="topup_admin_password"
                type={'password'}
                placeholder={'发放积分需要验证管理员密码'}
                onChange={value => handleTopUpInputChange('admin_password', value)}
                value={topUpInputs.admin_password}
                autoComplete="new-password"
              />
              <Button style={{ marginTop: 16 }} theme="solid" onClick={submitTopUp}>发放积分</Button>
            </>
          }
          <Divider style={{ marginTop: 20 }}>以下信息不可修改</Divider>
          <div style={{ marginTop: 20 }}>
            <Typography.Text>已绑定的 GitHub 账户</Typography.Text>
          </div>
          <Input
            name="github_id"
            value={github_id}
            autoComplete="new-password"
            placeholder="此项只读，需要用户通过个人设置页面的相关绑定按钮进行绑定，不可直接修改"
            readonly
          />
          <div style={{ marginTop: 20 }}>
            <Typography.Text>已绑定的微信账户</Typography.Text>
          </div>
          <Input
            name="wechat_id"
            value={wechat_id}
            autoComplete="new-password"
            placeholder="此项只读，需要用户通过个人设置页面的相关绑定按钮进行绑定，不可直接修改"
            readonly
          />
          <Input
            name="telegram_id"
            value={telegram_id}
            autoComplete="new-password"
            placeholder="此项只读，需要用户通过个人设置页面的相关绑定按钮进行绑定，不可直接修改"
            readonly
          />
          <div style={{ marginTop: 20 }}>
            <Typography.Text>已绑定的邮箱账户</Typography.Text>
          </div>
          <Input
            name="email"
            value={email}
            autoComplete="new-password"
            placeholder="此项只读，需要用户通过个人设置页面的相关绑定按钮进行绑定，不可直接修改"
            readonly
          />
        </Spin>
      </SideSheet>
    </>
  );
};

export default EditUser;
