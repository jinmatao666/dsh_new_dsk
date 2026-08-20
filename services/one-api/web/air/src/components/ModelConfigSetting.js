import React, { useEffect, useState } from 'react';
import { Button, Form, Icon } from 'semantic-ui-react';
import { API, showError, showSuccess, verifyJSON } from '../helpers';
import { MergedModelRatioTable, CompactGroupRatioEditor } from './ratioEditors';
import useNavigationBlocker from '../hooks/useNavigationBlocker';
import { ConfigPageFooter, ConfigPageLayout, ConfigPageTabPane, ConfigPageTabs } from './ConfigPageLayout';

// 受脏检查约束的字段分组:倍率 tab 与上下文 tab 各管一组 key
const RATIO_KEYS = ['ModelRatio', 'CompletionRatio', 'GroupRatio'];
const CONTEXT_KEYS = ['ModelContextLimits', 'DefaultContextLimit'];
const PRECONSUME_KEYS = ['PreConsumedQuota'];

// 模型配置:模型倍率 / 补全倍率 / 分组倍率 + 上下文限制
// 数据流与 OperationSetting 一致:GET /api/option/ 读取,PUT /api/option/ 逐项保存
// embedded:被模型配置页作为子 tab 内嵌时为 true,此时不再渲染外层 ConfigPageLayout,
// 避免与外层页面重复包裹(布局由外层负责)。
const ModelConfigSetting = ({ embedded = false }) => {
  const [inputs, setInputs] = useState({
    ModelRatio: '',
    CompletionRatio: '',
    GroupRatio: '',
    ModelContextLimits: '',
    DefaultContextLimit: 198000,
    PreConsumedQuota: 1000
  });
  const [originInputs, setOriginInputs] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('ratio');
  // 每个 tab 的脏状态:与已保存的 originInputs 比对
  const ratioDirty = RATIO_KEYS.some((k) => (inputs[k] ?? '') !== (originInputs[k] ?? ''));
  const contextDirty = CONTEXT_KEYS.some(
    (k) => String(inputs[k] ?? '') !== String(originInputs[k] ?? '')
  );
  const preConsumeDirty = PRECONSUME_KEYS.some(
    (k) => String(inputs[k] ?? '') !== String(originInputs[k] ?? '')
  );
  const anyDirty = ratioDirty || contextDirty || preConsumeDirty;
  const activeDirty = activeTab === 'ratio' ? ratioDirty : activeTab === 'context' ? contextDirty : preConsumeDirty;
  // 倍率视图模式:模型/补全合并为一组,分组倍率独立。默认表格视图
  const [ratioViewMode, setRatioViewMode] = useState({
    ModelAndCompletion: 'table',
    GroupRatio: 'table',
    ModelContextLimits: 'table'
  });
  const toggleRatioView = (key) => {
    setRatioViewMode((m) => ({ ...m, [key]: m[key] === 'table' ? 'json' : 'table' }));
  };
  const setRatioValue = (key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const getOptions = async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (success) {
      let newInputs = {};
      data.forEach((item) => {
        if (item.key === 'ModelRatio' || item.key === 'GroupRatio' || item.key === 'CompletionRatio' || item.key === 'ModelContextLimits') {
          item.value = JSON.stringify(JSON.parse(item.value), null, 2);
        }
        if (item.value === '{}') {
          item.value = '';
        }
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
      // 保存成功后同步 inputs 与 originInputs，脏状态随之清除
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

  // 保存倍率设置（模型/补全/分组倍率）。返回是否全部成功。
  const submitRatio = async () => {
    let ok = true;
    if (originInputs['ModelRatio'] !== inputs.ModelRatio) {
      if (!verifyJSON(inputs.ModelRatio)) {
        showError('模型倍率不是合法的 JSON 字符串');
        return false;
      }
      ok = (await updateOption('ModelRatio', inputs.ModelRatio)) && ok;
    }
    if (originInputs['GroupRatio'] !== inputs.GroupRatio) {
      if (!verifyJSON(inputs.GroupRatio)) {
        showError('分组倍率不是合法的 JSON 字符串');
        return false;
      }
      ok = (await updateOption('GroupRatio', inputs.GroupRatio)) && ok;
    }
    if (originInputs['CompletionRatio'] !== inputs.CompletionRatio) {
      if (!verifyJSON(inputs.CompletionRatio)) {
        showError('补全倍率不是合法的 JSON 字符串');
        return false;
      }
      ok = (await updateOption('CompletionRatio', inputs.CompletionRatio)) && ok;
    }
    if (ok) showSuccess('倍率设置已保存');
    return ok;
  };

  // 保存上下文限制设置。返回是否全部成功。
  const submitContext = async () => {
    let ok = true;
    if (originInputs['ModelContextLimits'] !== inputs.ModelContextLimits) {
      if (inputs.ModelContextLimits && !verifyJSON(inputs.ModelContextLimits)) {
        showError('模型上下文限制不是合法的 JSON 字符串');
        return false;
      }
      ok = (await updateOption('ModelContextLimits', inputs.ModelContextLimits)) && ok;
    }
    if (String(originInputs['DefaultContextLimit'] ?? '') !== String(inputs.DefaultContextLimit ?? '')) {
      ok = (await updateOption('DefaultContextLimit', String(inputs.DefaultContextLimit))) && ok;
    }
    if (ok) showSuccess('上下文限制设置已保存');
    return ok;
  };

  // 保存预扣设置。返回是否全部成功。
  const submitPreConsume = async () => {
    let ok = true;
    if (String(originInputs['PreConsumedQuota'] ?? '') !== String(inputs.PreConsumedQuota ?? '')) {
      ok = (await updateOption('PreConsumedQuota', String(inputs.PreConsumedQuota))) && ok;
    }
    if (ok) showSuccess('预扣设置已保存');
    return ok;
  };

  // 保存当前激活的 tab。供底部栏与跳转拦截弹窗复用。
  const saveActive = async () => {
    if (activeTab === 'ratio') return await submitRatio();
    if (activeTab === 'context') return await submitContext();
    return await submitPreConsume();
  };

  // 保存所有有改动的 tab(供跳转拦截时一次性保存)
  const saveAll = async () => {
    let ok = true;
    if (ratioDirty) ok = (await submitRatio()) && ok;
    if (contextDirty) ok = (await submitContext()) && ok;
    if (preConsumeDirty) ok = (await submitPreConsume()) && ok;
    return ok;
  };

  // 取消:把当前 tab 的字段恢复为已保存值
  const cancelActive = () => {
    const keys = activeTab === 'ratio' ? RATIO_KEYS : activeTab === 'context' ? CONTEXT_KEYS : PRECONSUME_KEYS;
    setInputs((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { next[k] = originInputs[k]; });
      return next;
    });
  };

  // 放弃所有改动(跳转拦截时选择"放弃修改")
  const discardAll = () => {
    setInputs((prev) => ({ ...prev, ...originInputs }));
  };

  // 拦截站内跳转:有未保存改动时弹窗
  useNavigationBlocker({ when: anyDirty, onSave: saveAll, onDiscard: discardAll });

  const Wrapper = embedded ? React.Fragment : ConfigPageLayout;
  return (
    <Wrapper>
    <ConfigPageTabs
      activeKey={activeTab}
      onChange={(k) => setActiveTab(k)}
    >
      <ConfigPageTabPane tab="倍率设置" itemKey="ratio">
        <Form loading={loading}>
          {/* 模型倍率 + 补全倍率:合并为一张 3 列表,避免重复输入模型名 */}
          <Form.Field>
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8
            }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>模型倍率 &amp; 补全倍率</span>
              <Button
                size='mini'
                basic
                compact
                type='button'
                style={{ boxShadow: 'none', color: '#007AFF', background: 'transparent' }}
                onClick={() => toggleRatioView('ModelAndCompletion')}
              >
                <Icon name={ratioViewMode.ModelAndCompletion === 'table' ? 'code' : 'table'} />
                {ratioViewMode.ModelAndCompletion === 'table' ? 'JSON 编辑' : '表格编辑'}
              </Button>
            </label>
            {ratioViewMode.ModelAndCompletion === 'table' ? (
              <MergedModelRatioTable
                modelRatio={inputs.ModelRatio}
                completionRatio={inputs.CompletionRatio}
                onChangeModel={(v) => setRatioValue('ModelRatio', v)}
                onChangeCompletion={(v) => setRatioValue('CompletionRatio', v)}
              />
            ) : (
              // JSON 视图:两个 TextArea 并排展示,方便手工编辑/复制粘贴
              <Form.Group widths='equal'>
                <Form.TextArea
                  label='模型倍率 (ModelRatio)'
                  name='ModelRatio'
                  onChange={handleInputChange}
                  style={{ minHeight: 250, fontFamily: 'JetBrains Mono, Consolas' }}
                  autoComplete='new-password'
                  value={inputs.ModelRatio}
                  placeholder='为一个 JSON 文本,键为模型名称,值为倍率'
                />
                <Form.TextArea
                  label='补全倍率 (CompletionRatio)'
                  name='CompletionRatio'
                  onChange={handleInputChange}
                  style={{ minHeight: 250, fontFamily: 'JetBrains Mono, Consolas' }}
                  autoComplete='new-password'
                  value={inputs.CompletionRatio}
                  placeholder='为一个 JSON 文本,键为模型名称,值为补全倍率相较于提示倍率的比例,可强制覆盖内部默认值'
                />
              </Form.Group>
            )}
          </Form.Field>

          {/* 分组倍率:第一版按需求暂时隐藏(T3.3)。保留代码,后续可恢复。 */}
          {false && (
          <Form.Field>
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8, marginTop: 16
            }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>分组倍率</span>
              <Button
                size='mini'
                basic
                compact
                type='button'
                style={{ boxShadow: 'none', color: '#007AFF', background: 'transparent' }}
                onClick={() => toggleRatioView('GroupRatio')}
              >
                <Icon name={ratioViewMode.GroupRatio === 'table' ? 'code' : 'table'} />
                {ratioViewMode.GroupRatio === 'table' ? 'JSON 编辑' : '表格编辑'}
              </Button>
            </label>
            {ratioViewMode.GroupRatio === 'table' ? (
              <CompactGroupRatioEditor
                value={inputs.GroupRatio}
                onChange={(v) => setRatioValue('GroupRatio', v)}
              />
            ) : (
              <Form.TextArea
                name='GroupRatio'
                onChange={handleInputChange}
                style={{ minHeight: 180, fontFamily: 'JetBrains Mono, Consolas' }}
                autoComplete='new-password'
                value={inputs.GroupRatio}
                placeholder='为一个 JSON 文本,键为分组名称,值为倍率'
              />
            )}
          </Form.Field>
          )}
        </Form>
      </ConfigPageTabPane>

      <ConfigPageTabPane tab="上下文限制" itemKey="context">
        <Form loading={loading}>
          {/* 模型上下文限制:类似分组倍率的表格编辑 */}
          <Form.Field>
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8
            }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>模型上下文限制（tokens）</span>
              <Button
                size='mini'
                basic
                compact
                type='button'
                style={{ boxShadow: 'none', color: '#007AFF', background: 'transparent' }}
                onClick={() => toggleRatioView('ModelContextLimits')}
              >
                <Icon name={ratioViewMode.ModelContextLimits === 'table' ? 'code' : 'table'} />
                {ratioViewMode.ModelContextLimits === 'table' ? 'JSON 编辑' : '表格编辑'}
              </Button>
            </label>
            <p style={{ fontSize: 12, color: '#86868b', marginBottom: 8 }}>
              模型名包含 key（不区分大小写）即命中，未命中则使用默认上下文限制
            </p>
            {ratioViewMode.ModelContextLimits === 'table' ? (
              <CompactGroupRatioEditor
                value={inputs.ModelContextLimits}
                onChange={(v) => setRatioValue('ModelContextLimits', v)}
                nameLabel='模型关键词'
                valueLabel='上下文限制 (tokens)'
                namePlaceholder='例如 deepseek'
                valuePlaceholder='1000000'
                emptyText='暂无配置,点击下方「新增模型」添加'
                addText='新增模型'
              />
            ) : (
              <Form.TextArea
                name='ModelContextLimits'
                onChange={handleInputChange}
                style={{ minHeight: 180, fontFamily: 'JetBrains Mono, Consolas' }}
                autoComplete='new-password'
                value={inputs.ModelContextLimits}
                placeholder='{"deepseek": 1000000, "glm": 198000, "qwen": 1000000, "minimax": 200000}'
              />
            )}
          </Form.Field>
          <Form.Group widths={4}>
            <Form.Input
              label='默认上下文限制（未匹配模型时使用）'
              name='DefaultContextLimit'
              onChange={handleInputChange}
              autoComplete='new-password'
              value={inputs.DefaultContextLimit}
              type='number'
              min='1000'
              placeholder='198000'
            />
          </Form.Group>
        </Form>
      </ConfigPageTabPane>

      <ConfigPageTabPane tab="预扣设置" itemKey="preconsume">
        <Form loading={loading}>
          <p style={{ fontSize: 12, color: '#86868b', marginBottom: 8 }}>
            每次请求开始前预先扣除的 token 数量，请求结束后按实际用量多退少补
          </p>
          <Form.Group widths={4}>
            <Form.Input
              label='预扣额度（token）'
              name='PreConsumedQuota'
              onChange={handleInputChange}
              autoComplete='new-password'
              value={inputs.PreConsumedQuota}
              type='number'
              min='0'
              placeholder='1000'
            />
          </Form.Group>
        </Form>
      </ConfigPageTabPane>
    </ConfigPageTabs>
    <ConfigPageFooter
      dirty={activeDirty}
      loading={loading}
      onCancel={cancelActive}
      onSave={() => { saveActive().then(); }}
    />
    </Wrapper>
  );
};

export default ModelConfigSetting;
