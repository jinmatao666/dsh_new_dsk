import React, { useEffect, useState } from 'react';
import { API, isMobile, showError, showSuccess, timestamp2string } from '../helpers';
import { renderQuotaWithPrompt } from '../helpers/render';
import {
  AutoComplete,
  Banner,
  Button,
  DatePicker,
  Input,
  SideSheet,
  Space,
  Spin,
  Typography
} from '@douyinfe/semi-ui';
import Title from '@douyinfe/semi-ui/lib/es/typography/title';
import { Divider } from 'semantic-ui-react';

const EditUserToken = (props) => {
  const { userId, editingToken, visible, handleClose, refresh } = props;
  const isEdit = editingToken && editingToken.id !== undefined;
  const originInputs = {
    name: '',
    remain_quota: 500000,
    expired_time: -1,
    unlimited_quota: false
  };
  const [inputs, setInputs] = useState(originInputs);
  const [loading, setLoading] = useState(false);
  const [tokenCount, setTokenCount] = useState(1);

  const { name, remain_quota, expired_time, unlimited_quota } = inputs;

  const handleInputChange = (key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const setExpiredTime = (month, day, hour, minute) => {
    const now = new Date();
    let timestamp = now.getTime() / 1000;
    let seconds = month * 30 * 24 * 60 * 60;
    seconds += day * 24 * 60 * 60;
    seconds += hour * 60 * 60;
    seconds += minute * 60;
    if (seconds !== 0) {
      timestamp += seconds;
      setInputs((prev) => ({ ...prev, expired_time: timestamp2string(timestamp) }));
    } else {
      setInputs((prev) => ({ ...prev, expired_time: -1 }));
    }
  };

  const loadToken = async () => {
    setLoading(true);
    const res = await API.get(`/api/admin/token/user/${userId}`);
    const { success, message, data } = res.data;
    if (success) {
      const found = (data || []).find((t) => t.id === editingToken.id);
      if (found) {
        const next = { ...found };
        if (next.expired_time !== -1) {
          next.expired_time = timestamp2string(next.expired_time);
        }
        setInputs(next);
      }
    } else {
      showError(message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!visible) return;
    if (isEdit) {
      loadToken();
    } else {
      setInputs(originInputs);
      setTokenCount(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingToken && editingToken.id]);

  const generateRandomSuffix = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  };

  const submit = async () => {
    setLoading(true);
    try {
      if (isEdit) {
        const localInputs = { ...inputs };
        localInputs.remain_quota = parseInt(localInputs.remain_quota);
        if (localInputs.expired_time !== -1) {
          const time = Date.parse(localInputs.expired_time);
          if (isNaN(time)) {
            showError('过期时间格式错误！');
            return;
          }
          localInputs.expired_time = Math.ceil(time / 1000);
        }
        const res = await API.put(`/api/admin/token/user/${userId}`, {
          ...localInputs,
          id: parseInt(editingToken.id)
        });
        const { success, message } = res.data;
        if (success) {
          showSuccess('令牌更新成功');
          refresh && refresh();
          handleClose();
        } else {
          showError(message);
        }
      } else {
        let successCount = 0;
        for (let i = 0; i < tokenCount; i++) {
          const localInputs = { ...inputs };
          if (i !== 0) {
            localInputs.name = `${inputs.name}-${generateRandomSuffix()}`;
          }
          localInputs.remain_quota = parseInt(localInputs.remain_quota);
          if (localInputs.expired_time !== -1) {
            const time = Date.parse(localInputs.expired_time);
            if (isNaN(time)) {
              showError('过期时间格式错误！');
              break;
            }
            localInputs.expired_time = Math.ceil(time / 1000);
          }
          const res = await API.post(`/api/admin/token/user/${userId}`, localInputs);
          const { success, message } = res.data;
          if (success) {
            successCount++;
          } else {
            showError(message);
            break;
          }
        }
        if (successCount > 0) {
          showSuccess(`${successCount} 个令牌创建成功`);
          refresh && refresh();
          handleClose();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SideSheet
      placement={isEdit ? 'right' : 'left'}
      title={<Title level={3}>{isEdit ? '更新令牌信息' : '为该用户创建令牌'}</Title>}
      headerStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
      bodyStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
      visible={visible}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            <Button theme="solid" size="large" onClick={submit}>提交</Button>
            <Button theme="solid" size="large" type="tertiary" onClick={handleClose}>取消</Button>
          </Space>
        </div>
      }
      closeIcon={null}
      onCancel={handleClose}
      width={isMobile() ? '100%' : 560}
    >
      <Spin spinning={loading}>
        <Input
          style={{ marginTop: 20 }}
          label="名称"
          name="name"
          placeholder="请输入名称"
          onChange={(value) => handleInputChange('name', value)}
          value={name}
          autoComplete="new-password"
          required={!isEdit}
        />
        <Divider />
        <DatePicker
          label="过期时间"
          name="expired_time"
          placeholder="请选择过期时间"
          onChange={(value) => handleInputChange('expired_time', value)}
          value={expired_time}
          autoComplete="new-password"
          type="dateTime"
        />
        <div style={{ marginTop: 20 }}>
          <Space>
            <Button type="tertiary" onClick={() => setExpiredTime(0, 0, 0, 0)}>永不过期</Button>
            <Button type="tertiary" onClick={() => setExpiredTime(0, 0, 1, 0)}>一小时</Button>
            <Button type="tertiary" onClick={() => setExpiredTime(1, 0, 0, 0)}>一个月</Button>
            <Button type="tertiary" onClick={() => setExpiredTime(0, 1, 0, 0)}>一天</Button>
          </Space>
        </div>

        <Divider />
        <Banner
          type="warning"
          description="令牌额度仅限制令牌本身的最大可用量，实际消耗仍受用户账户剩余额度约束。"
        />
        <div style={{ marginTop: 20 }}>
          <Typography.Text>{`额度${renderQuotaWithPrompt(remain_quota)}`}</Typography.Text>
        </div>
        <AutoComplete
          style={{ marginTop: 8 }}
          name="remain_quota"
          placeholder="请输入额度"
          onChange={(value) => handleInputChange('remain_quota', value)}
          value={remain_quota}
          autoComplete="new-password"
          type="number"
          data={[
            { value: 500000, label: '1$' },
            { value: 5000000, label: '10$' },
            { value: 25000000, label: '50$' },
            { value: 50000000, label: '100$' },
            { value: 250000000, label: '500$' },
            { value: 500000000, label: '1000$' }
          ]}
          disabled={unlimited_quota}
        />

        {!isEdit && (
          <>
            <div style={{ marginTop: 20 }}>
              <Typography.Text>新建数量</Typography.Text>
            </div>
            <AutoComplete
              style={{ marginTop: 8 }}
              placeholder="请选择或输入创建令牌的数量"
              onChange={(value) => {
                const count = parseInt(value, 10);
                if (!isNaN(count) && count > 0) setTokenCount(count);
              }}
              onSelect={(value) => setTokenCount(value)}
              value={tokenCount.toString()}
              autoComplete="off"
              type="number"
              data={[
                { value: 10, label: '10个' },
                { value: 20, label: '20个' },
                { value: 30, label: '30个' },
                { value: 100, label: '100个' }
              ]}
              disabled={unlimited_quota}
            />
          </>
        )}

        <div>
          <Button
            style={{ marginTop: 8 }}
            type="warning"
            onClick={() => setInputs((prev) => ({ ...prev, unlimited_quota: !prev.unlimited_quota }))}
          >
            {unlimited_quota ? '取消无限额度' : '设为无限额度'}
          </Button>
        </div>
      </Spin>
    </SideSheet>
  );
};

export default EditUserToken;
