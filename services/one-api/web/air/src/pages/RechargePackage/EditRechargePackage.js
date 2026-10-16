import React, { useEffect, useState } from 'react';
import { API, isMobile, showError, showSuccess, verifyJSON } from '../../helpers';
import {
  Button,
  Form,
  Popconfirm,
  SideSheet,
  Space,
  Spin,
  Switch,
  Typography
} from '@douyinfe/semi-ui';

const { Text } = Typography;

// 充值/订阅套餐 新增/编辑弹窗
// 价格字段统一以「分」存储（与后端一致），label 实时换算「元」提示
const EditRechargePackage = (props) => {
  const isEdit = props.editingPackage.id !== undefined;
  const [loading, setLoading] = useState(isEdit);

  const originInputs = {
    name: '',
    description: '',
    price: 0,
    point: 0,
    level: 0,
    monthly_price: 0,
    yearly_price: 0,
    monthly_price_sale: 0,
    yearly_price_sale: 0,
    features: '[]',
    badge: '',
    card_style: '',
    sort: 0,
    enabled: true
  };
  const [inputs, setInputs] = useState(originInputs);

  const handleCancel = () => {
    props.handleClose();
  };

  const handleInputChange = (name, value) => {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const loadPackage = async () => {
    setLoading(true);
    const res = await API.get('/api/recharge-package/');
    const { success, message, data } = res.data;
    if (success) {
      const found = (data || []).find((p) => p.id === props.editingPackage.id);
      if (found) {
        setInputs({
          ...found,
          // 分 → 元 用于表单编辑
          price: (parseInt(found.price) || 0) / 100,
          monthly_price: (parseInt(found.monthly_price) || 0) / 100,
          yearly_price: (parseInt(found.yearly_price) || 0) / 100,
          monthly_price_sale: (parseInt(found.monthly_price_sale) || 0) / 100,
          yearly_price_sale: (parseInt(found.yearly_price_sale) || 0) / 100,
          features: found.features && found.features !== '' ? found.features : '[]'
        });
      } else {
        showError('未找到该套餐');
      }
    } else {
      showError(message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isEdit) {
      loadPackage().then();
    } else {
      setInputs(originInputs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.editingPackage.id]);

  const submit = async () => {
    if (inputs.name === '') {
      showError('套餐名称不能为空');
      return;
    }
    if (inputs.features && !verifyJSON(inputs.features)) {
      showError('套餐特性不是合法的 JSON 数组');
      return;
    }
    setLoading(true);
    // 价格字段：元 → 分 存储；其余数值字段统一转 number
    const toCents = (yuanVal) => Math.round((parseFloat(yuanVal) || 0) * 100);
    const payload = {
      ...inputs,
      price: toCents(inputs.price),
      point: parseFloat(inputs.point) || 0,
      level: parseInt(inputs.level) || 0,
      monthly_price: toCents(inputs.monthly_price),
      yearly_price: toCents(inputs.yearly_price),
      monthly_price_sale: toCents(inputs.monthly_price_sale),
      yearly_price_sale: toCents(inputs.yearly_price_sale),
      sort: parseInt(inputs.sort) || 0,
      features: inputs.features && inputs.features !== '' ? inputs.features : '[]'
    };
    let res;
    if (isEdit) {
      res = await API.put('/api/recharge-package/', payload);
    } else {
      res = await API.post('/api/recharge-package/', payload);
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess(isEdit ? '套餐更新成功！' : '套餐创建成功！');
      props.refresh();
      props.handleClose();
    } else {
      showError(message);
    }
    setLoading(false);
  };

  return (
    <PackageForm
      isEdit={isEdit}
      loading={loading}
      inputs={inputs}
      formKey={`${props.editingPackage.id ?? 'new'}-${loading ? 'loading' : 'ready'}`}
      visible={props.visible}
      onChange={handleInputChange}
      onCancel={handleCancel}
      onSubmit={submit}
    />
  );
};

export default EditRechargePackage;

// 表单主体（函数声明，hoisted，可在上方引用）
function PackageForm({ isEdit, loading, inputs, formKey, visible, onChange, onCancel, onSubmit }) {
  return (
    <SideSheet
      placement="left"
      title={<Typography.Title level={4}>{isEdit ? '更新商品' : '新建商品'}</Typography.Title>}
      headerStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
      bodyStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
      visible={visible}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            {isEdit ? (
              <Popconfirm
                title="确认提交修改？"
                content="提交后将立即更新该商品信息"
                position="top"
                onConfirm={onSubmit}
              >
                <Button theme="solid" size="large">提交</Button>
              </Popconfirm>
            ) : (
              <Button theme="solid" size="large" onClick={onSubmit}>提交</Button>
            )}
            <Button theme="solid" size="large" type="tertiary" onClick={onCancel}>取消</Button>
          </Space>
        </div>
      }
      closeIcon={null}
      onCancel={onCancel}
      width={isMobile() ? '100%' : 560}
    >
      <Spin spinning={loading}>
        <Form key={formKey} initValues={inputs}>
          <Form.Section text="基本信息">
            <Form.Input
              field="name"
              label="套餐名称"
              placeholder="例如：专业版"
              value={inputs.name}
              onChange={(v) => onChange('name', v)}
            />
            <Form.TextArea
              field="description"
              label="套餐描述"
              placeholder="一句话介绍该套餐"
              value={inputs.description}
              onChange={(v) => onChange('description', v)}
              autosize
            />
            <Form.InputNumber
              field="point"
              label="每月发放积分"
              min={0}
              style={{ width: '100%' }}
              value={inputs.point}
              onChange={(v) => onChange('point', v)}
            />
            <Form.InputNumber
              field="level"
              label="套餐等级（数字越大等级越高）"
              min={0}
              style={{ width: '100%' }}
              value={inputs.level}
              onChange={(v) => onChange('level', v)}
            />
          </Form.Section>

          <Form.Section text="价格（单位：元）">
            <Form.InputNumber
              field="price"
              label="默认展示价"
              min={0}
              precision={2}
              step={1}
              style={{ width: '100%' }}
              value={inputs.price}
              onChange={(v) => onChange('price', v)}
            />
            <Form.InputNumber
              field="monthly_price"
              label="月付价"
              min={0}
              precision={2}
              step={1}
              style={{ width: '100%' }}
              value={inputs.monthly_price}
              onChange={(v) => onChange('monthly_price', v)}
            />
            <Form.InputNumber
              field="monthly_price_sale"
              label="月付折扣价"
              min={0}
              precision={2}
              step={1}
              style={{ width: '100%' }}
              value={inputs.monthly_price_sale}
              onChange={(v) => onChange('monthly_price_sale', v)}
            />
            <Form.InputNumber
              field="yearly_price"
              label="年付价"
              min={0}
              precision={2}
              step={1}
              style={{ width: '100%' }}
              value={inputs.yearly_price}
              onChange={(v) => onChange('yearly_price', v)}
            />
            <Form.InputNumber
              field="yearly_price_sale"
              label="年付折扣价"
              min={0}
              precision={2}
              step={1}
              style={{ width: '100%' }}
              value={inputs.yearly_price_sale}
              onChange={(v) => onChange('yearly_price_sale', v)}
            />
          </Form.Section>

          <Form.Section text="展示与排序">
            <Form.Input
              field="badge"
              label="角标文字（如：热卖、推荐，留空则不显示）"
              placeholder="留空则无角标"
              value={inputs.badge}
              onChange={(v) => onChange('badge', v)}
            />
            <Form.Input
              field="card_style"
              label="卡片样式标识（前端按此渲染样式，可留空）"
              placeholder="例如：highlight"
              value={inputs.card_style}
              onChange={(v) => onChange('card_style', v)}
            />
            <Form.InputNumber
              field="sort"
              label="排序权重（越小越靠前）"
              style={{ width: '100%' }}
              value={inputs.sort}
              onChange={(v) => onChange('sort', v)}
            />
            <Form.TextArea
              field="features"
              label="套餐特性（JSON 数组）"
              placeholder='例如：["无限对话", "优先支持", "更高并发"]'
              value={inputs.features}
              onChange={(v) => onChange('features', v)}
              autosize={{ minRows: 3 }}
              style={{ fontFamily: 'JetBrains Mono, Consolas, monospace' }}
            />
            <div style={{ marginTop: 12 }}>
              <Text style={{ marginRight: 12 }}>启用</Text>
              <Switch checked={inputs.enabled} onChange={(v) => onChange('enabled', v)} />
            </div>
          </Form.Section>
        </Form>
      </Spin>
    </SideSheet>
  );
}
