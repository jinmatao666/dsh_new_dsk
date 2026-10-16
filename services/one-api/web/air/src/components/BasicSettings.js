import React, { useEffect, useState } from 'react';
import { Button, Form } from 'semantic-ui-react';
import { API, showError, showSuccess } from '../helpers';

// 基础设置(替代原「计费与基础设置」的多 tab):
// 倍率/上下文映射等配置已迁入「模型配置」页逐模型维护,这里只保留两个全局项:
//   - 预扣额度(PreConsumedQuota)
//   - 默认上下文限制(DefaultContextLimit,未匹配到模型时使用),放在预扣下面
// 数据流与 OperationSetting 一致:GET/PUT /api/option/。
const BasicSettings = () => {
  const [inputs, setInputs] = useState({
    PreConsumedQuota: 1000,
    DefaultContextLimit: 198000,
  });
  const [origin, setOrigin] = useState({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/option/');
      const { success, message, data } = res.data;
      if (success) {
        const next = {};
        data.forEach((it) => {
          if (it.key === 'PreConsumedQuota' || it.key === 'DefaultContextLimit') {
            next[it.key] = it.value;
          }
        });
        setInputs((prev) => ({ ...prev, ...next }));
        setOrigin({ ...next });
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const dirty =
    String(inputs.PreConsumedQuota ?? '') !== String(origin.PreConsumedQuota ?? '') ||
    String(inputs.DefaultContextLimit ?? '') !== String(origin.DefaultContextLimit ?? '');

  const handleChange = (e, { name, value }) => {
    setInputs((prev) => ({ ...prev, [name]: value }));
  };

  const updateOption = async (key, value) => {
    const res = await API.put('/api/option/', { key, value: String(value) });
    return res.data.success;
  };

  const save = async () => {
    setLoading(true);
    let ok = true;
    try {
      if (String(inputs.PreConsumedQuota ?? '') !== String(origin.PreConsumedQuota ?? '')) {
        ok = (await updateOption('PreConsumedQuota', inputs.PreConsumedQuota)) && ok;
      }
      if (String(inputs.DefaultContextLimit ?? '') !== String(origin.DefaultContextLimit ?? '')) {
        ok = (await updateOption('DefaultContextLimit', inputs.DefaultContextLimit)) && ok;
      }
      if (ok) {
        showSuccess('基础设置已保存');
        setOrigin({
          PreConsumedQuota: inputs.PreConsumedQuota,
          DefaultContextLimit: inputs.DefaultContextLimit,
        });
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  return (
    <Form loading={loading} style={{ maxWidth: 520 }}>
      <p style={{ fontSize: 12, color: '#86868b', marginBottom: 8 }}>
        每次请求开始前预先扣除的 token 数量，请求结束后按实际用量多退少补
      </p>
      <Form.Input
        label='预扣额度（token）'
        name='PreConsumedQuota'
        onChange={handleChange}
        value={inputs.PreConsumedQuota}
        type='number'
        min='0'
        placeholder='1000'
        autoComplete='new-password'
      />
      <p style={{ fontSize: 12, color: '#86868b', margin: '16px 0 8px' }}>
        未匹配到具体模型的上下文配置时,使用该默认上下文限制
      </p>
      <Form.Input
        label='默认上下文限制（未匹配模型时使用，tokens）'
        name='DefaultContextLimit'
        onChange={handleChange}
        value={inputs.DefaultContextLimit}
        type='number'
        min='0'
        placeholder='198000'
        autoComplete='new-password'
      />
      <Button primary type='button' disabled={!dirty || loading} loading={loading} onClick={save}>
        保存设置
      </Button>
    </Form>
  );
};

export default BasicSettings;
