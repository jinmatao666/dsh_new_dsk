import React, { useEffect, useState } from 'react';
import { Form, Grid, Header } from 'semantic-ui-react';
import { API, showError, showSuccess } from '../helpers';
import useNavigationBlocker from '../hooks/useNavigationBlocker';
import { ConfigPageFooter, ConfigPageLayout } from './ConfigPageLayout';

const QUOTA_KEYS = ['QuotaForInviter', 'QuotaForInvitee'];

// 积分额度配置:邀请奖励
// 新用户注册赠送已统一改由「活动配置」(register 触发)发放,此处不再提供。
// 每月免费额度由「试用包」(个人套餐中 price=0 的套餐)的 point 决定,见 GetTrialFreeQuota,不再走 option。
// 数据流与 OperationSetting 一致:GET /api/option/ 读取,PUT /api/option/ 逐项保存
const QuotaConfigSetting = () => {
  const [inputs, setInputs] = useState({
    QuotaForInviter: 0,
    QuotaForInvitee: 0
  });
  const [originInputs, setOriginInputs] = useState({});
  const [loading, setLoading] = useState(false);
  const dirty = QUOTA_KEYS.some((key) => String(inputs[key] ?? '') !== String(originInputs[key] ?? ''));

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

  useEffect(() => {
    getOptions().then();
  }, []);

  const updateOption = async (key, value) => {
    setLoading(true);
    const res = await API.put('/api/option/', { key, value });
    const { success, message } = res.data;
    if (success) {
      setInputs((inputs) => ({ ...inputs, [key]: value }));
      setOriginInputs((origin) => ({ ...origin, [key]: value }));
    } else {
      showError(message);
    }
    setLoading(false);
    return success;
  };

  const handleInputChange = async (e, { name, value }) => {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const submitQuota = async () => {
    let ok = true;
    if (originInputs['QuotaForInvitee'] !== inputs.QuotaForInvitee) {
      ok = (await updateOption('QuotaForInvitee', inputs.QuotaForInvitee)) && ok;
    }
    if (originInputs['QuotaForInviter'] !== inputs.QuotaForInviter) {
      ok = (await updateOption('QuotaForInviter', inputs.QuotaForInviter)) && ok;
    }
    if (ok) showSuccess('额度设置已保存');
    return ok;
  };

  const cancelQuota = () => {
    setInputs((prev) => ({ ...prev, ...originInputs }));
  };

  useNavigationBlocker({ when: dirty, onSave: submitQuota, onDiscard: cancelQuota });

  return (
    <ConfigPageLayout>
      <Grid columns={1}>
        <Grid.Column>
          <Form loading={loading}>
            <Header as='h3'>
              额度设置
            </Header>
            <Form.Group widths={2}>
              <Form.Input
                label='邀请新用户奖励额度'
                name='QuotaForInviter'
                onChange={handleInputChange}
                autoComplete='new-password'
                value={inputs.QuotaForInviter}
                type='number'
                min='0'
                placeholder='例如：2000'
              />
              <Form.Input
                label='新用户使用邀请码奖励额度'
                name='QuotaForInvitee'
                onChange={handleInputChange}
                autoComplete='new-password'
                value={inputs.QuotaForInvitee}
                type='number'
                min='0'
                placeholder='例如：1000'
              />
            </Form.Group>
          </Form>
        </Grid.Column>
      </Grid>
      <ConfigPageFooter
        dirty={dirty}
        loading={loading}
        saveText='保存额度设置'
        onCancel={cancelQuota}
        onSave={() => { submitQuota().then(); }}
      />
    </ConfigPageLayout>
  );
};

export default QuotaConfigSetting;
