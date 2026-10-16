import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Input, InputNumber, Select, Spin, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';
import { Plus, X } from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import { ConfigPageFooter, ConfigPageLayout } from '../../components/ConfigPageLayout';

const emptyForm = {
  id: 0,
  name: '',
  description: '',
  price: 0,
  quota_original_price: 0,
  point: 0,
  quota_days: 0,
  level: 0,
  duration_unit: 'month',
  duration_value: 1,
  point_cycle: 'month',
  identity_id: 0,
  detail: '',
  features: '[]',
  badge: '',
  sort: 0,
  enabled: true,
  scope: 'enterprise',
  package_type: 'subscription',
};

// features 存储为 JSON 数组字符串; 表单内用字符串数组编辑, 保存时序列化回去。
const parseFeatures = (raw) => {
  if (!raw || raw === '[]') return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch (_) {
    return [];
  }
};

const normalizeRecord = (record) => ({
  ...emptyForm,
  ...record,
  scope: record.scope || 'enterprise',
  package_type: record.package_type || 'subscription',
  duration_unit: record.duration_unit || 'month',
  duration_value: record.duration_value || 1,
  point_cycle: record.point_cycle || 'month',
  identity_id: record.identity_id || 0,
  detail: record.detail || '',
  price: Number(record.price || 0) / 100,
  quota_original_price: Number(record.quota_original_price || 0) / 100,
  features: record.features || '[]',
});

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  marginBottom: 14,
};

const labelStyle = {
  width: 148,
  flexShrink: 0,
  color: 'var(--semi-color-text-0)',
  fontSize: 14,
};

const fieldStyle = {
  flex: 1,
};

const serializeForm = (value) => JSON.stringify({
  ...value,
  point: Number(value.point || 0),
  quota_days: Number(value.quota_days || 0),
  quota_original_price: Number(value.quota_original_price || 0),
  duration_value: Number(value.duration_value || 0),
  identity_id: Number(value.identity_id || 0),
  sort: Number(value.sort || 0),
});

const EditProduct = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const initialScope = searchParams.get('scope') || location.state?.scope || 'enterprise';
  const [form, setForm] = useState({ ...emptyForm, scope: initialScope });
  const [originForm, setOriginForm] = useState({ ...emptyForm, scope: initialScope });
  const [loading, setLoading] = useState(isEdit);
  const [identities, setIdentities] = useState([]);
  const pageTitle = useMemo(() => (isEdit ? '编辑商品' : '新建商品'), [isEdit]);
  const dirty = serializeForm(form) !== serializeForm(originForm);

  // 拉取启用的会员身份, 供「关联会员身份」下拉使用
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await API.get('/api/member-identity/');
        if (alive && res.data.success) setIdentities(res.data.data || []);
      } catch (_) {
        if (alive) showError('加载会员身份失败');
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const stateRecord = location.state?.record;
    if (stateRecord && String(stateRecord.id) === String(id || '')) {
      const nextForm = normalizeRecord(stateRecord);
      setForm(nextForm);
      setOriginForm(nextForm);
      setLoading(false);
      return;
    }
    if (!isEdit) {
      const nextForm = { ...emptyForm, scope: initialScope };
      setForm(nextForm);
      setOriginForm(nextForm);
      setLoading(false);
      return;
    }

    let alive = true;
    const loadRecord = async () => {
      setLoading(true);
      const scopes = ['enterprise', 'personal'];
      for (const scope of scopes) {
        try {
          const res = await API.get(`/api/recharge-package/?scope=${scope}`);
          if (!res.data.success) continue;
          const found = (res.data.data || []).find((item) => String(item.id) === String(id));
          if (found) {
            if (alive) {
              const nextForm = normalizeRecord(found);
              setForm(nextForm);
              setOriginForm(nextForm);
              setLoading(false);
            }
            return;
          }
        } catch (_) {
          // continue searching another scope
        }
      }
      if (alive) {
        showError('未找到该商品');
        setLoading(false);
      }
    };

    loadRecord();
    return () => {
      alive = false;
    };
  }, [id, initialScope, isEdit, location.state]);

  const updateField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // 商品特性多行编辑: features 字符串数组的增/删/改
  const featureList = useMemo(() => parseFeatures(form.features), [form.features]);
  const setFeatureList = (list) => updateField('features', JSON.stringify(list));
  const addFeature = () => setFeatureList([...featureList, '']);
  const updateFeature = (idx, value) => {
    const next = [...featureList];
    next[idx] = value;
    setFeatureList(next);
  };
  const removeFeature = (idx) => setFeatureList(featureList.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!form.name) {
      showError('商品名称不能为空');
      return;
    }
    const isSubscription = (form.package_type || 'subscription') !== 'quota';
    // 仅付费(售价≠0)订阅商品必填会员身份;免费订阅(如试用包)走每月免费额度兜底,无需身份
    if (isSubscription && Number(form.price || 0) > 0 && !form.identity_id) {
      showError('付费订阅商品必须选择会员身份');
      return;
    }
    const payload = {
      ...form,
      price: Math.round(Number(form.price || 0) * 100),
      quota_original_price: Math.round(Number(form.quota_original_price || 0) * 100),
      point: Number(form.point),
      quota_days: Number(form.quota_days || 0),
      duration_value: Number(form.duration_value || 1),
      identity_id: Number(form.identity_id || 0),
      sort: Number(form.sort),
      features: form.features || '[]',
    };

    setLoading(true);
    try {
      const res = isEdit
        ? await API.put('/api/recharge-package/', payload)
        : await API.post('/api/recharge-package/', payload);
      if (res.data.success) {
        showSuccess(isEdit ? '已更新商品' : '已创建商品');
        setOriginForm(form);
        navigate('/transaction/products', { replace: true });
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('保存商品失败');
    }
    setLoading(false);
  };

  const handleCancel = () => {
    setForm(originForm);
  };

  return (
    <ConfigPageLayout>
      <div className="config-page-topbar">
        <Button icon={<IconArrowLeft />} theme="borderless" type="tertiary" onClick={() => navigate('/transaction/products')}>
          返回
        </Button>
        <Typography.Title heading={5} style={{ margin: 0 }}>{pageTitle}</Typography.Title>
      </div>
      <Spin spinning={loading}>
        <div style={{ maxWidth: 760 }}>
          <div style={rowStyle}>
            <div style={labelStyle}>商品类型</div>
            <div style={fieldStyle}>
              <Select value={form.scope} disabled style={{ width: '100%' }}>
                <Select.Option value="enterprise">企业商品</Select.Option>
                <Select.Option value="personal">个人商品</Select.Option>
              </Select>
            </div>
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>套餐类型</div>
            <div style={fieldStyle}>
              <Select value={form.package_type || 'subscription'} onChange={(v) => updateField('package_type', v)} style={{ width: '100%' }}>
                <Select.Option value="subscription">订阅会员</Select.Option>
                <Select.Option value="quota">增值包（纯积分）</Select.Option>
              </Select>
            </div>
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>商品名称</div>
            <Input value={form.name} onChange={(v) => updateField('name', v)} style={fieldStyle} />
          </div>
          {(form.package_type || 'subscription') !== 'quota' && (
            <div style={rowStyle}>
              <div style={labelStyle}>时长</div>
              <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Select value={form.duration_unit} onChange={(v) => updateField('duration_unit', v)} style={{ width: 160 }}>
                  <Select.Option value="day">天</Select.Option>
                  <Select.Option value="month">月（30天）</Select.Option>
                  <Select.Option value="quarter">季（90天）</Select.Option>
                  <Select.Option value="year">年（365天）</Select.Option>
                </Select>
                <InputNumber min={1} value={form.duration_value} onChange={(v) => updateField('duration_value', v)} style={{ width: 120 }} />
              </div>
            </div>
          )}
          <div style={rowStyle}>
            <div style={labelStyle}>积分数</div>
            <InputNumber min={0} value={form.point} onChange={(v) => updateField('point', v)} style={fieldStyle} />
          </div>
          {(form.package_type || 'subscription') !== 'quota' && (
            <div style={rowStyle}>
              <div style={labelStyle}>发放周期</div>
              <div style={fieldStyle}>
                <Select value={form.point_cycle} onChange={(v) => updateField('point_cycle', v)} style={{ width: '100%' }}>
                  <Select.Option value="once">一次性</Select.Option>
                  <Select.Option value="month">月（30天）</Select.Option>
                  <Select.Option value="quarter">季（90天）</Select.Option>
                  <Select.Option value="year">年（365天）</Select.Option>
                </Select>
              </div>
            </div>
          )}
          {(form.package_type || 'subscription') === 'quota' && (
            <>
              <div style={rowStyle}>
                <div style={labelStyle}>售价（元）</div>
                <InputNumber
                  min={0} precision={2} value={form.price}
                  onChange={(v) => {
                    const price = Number(v || 0);
                    const orig = Number(form.quota_original_price || 0);
                    const discount = orig > 0 ? parseFloat((price / orig * 10).toFixed(2)) : 0;
                    setForm((prev) => ({ ...prev, price, _quota_discount: discount }));
                  }}
                  style={fieldStyle}
                />
              </div>
              <div style={rowStyle}>
                <div style={labelStyle}>原价（元）</div>
                <InputNumber
                  min={0} precision={2} value={form.quota_original_price}
                  onChange={(v) => {
                    const orig = Number(v || 0);
                    const price = Number(form.price || 0);
                    const discount = orig > 0 ? parseFloat((price / orig * 10).toFixed(2)) : 0;
                    setForm((prev) => ({ ...prev, quota_original_price: orig, _quota_discount: discount }));
                  }}
                  style={fieldStyle}
                />
              </div>
              <div style={rowStyle}>
                <div style={labelStyle}>折扣（如 8.5 = 85折）</div>
                <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <InputNumber
                    min={0} max={10} precision={2}
                    value={form._quota_discount != null ? form._quota_discount : (
                      form.price > 0 && form.quota_original_price > 0
                        ? parseFloat((form.price / form.quota_original_price * 10).toFixed(2))
                        : undefined
                    )}
                    onChange={(v) => {
                      const discount = Number(v || 0);
                      const orig = Number(form.quota_original_price || 0);
                      const price = orig > 0 ? parseFloat((orig * discount / 10).toFixed(2)) : Number(form.price || 0);
                      setForm((prev) => ({ ...prev, price, _quota_discount: discount }));
                    }}
                    style={{ flex: 1 }}
                  />
                  <span style={{ color: 'var(--semi-color-text-2)', fontSize: 14 }}>折</span>
                </div>
              </div>
            </>
          )}
          {(form.package_type || 'subscription') === 'quota' && (
            <div style={rowStyle}>
              <div style={labelStyle}>有效期</div>
              <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Select
                  value={form.quota_days === 0 ? 'unlimited' : 'days'}
                  onChange={(v) => updateField('quota_days', v === 'unlimited' ? 0 : (form.quota_days || 30))}
                  style={{ width: 120 }}
                >
                  <Select.Option value="unlimited">不限时</Select.Option>
                  <Select.Option value="days">有效期天数</Select.Option>
                </Select>
                {form.quota_days !== 0 && (
                  <>
                    <InputNumber
                      min={1}
                      value={form.quota_days}
                      onChange={(v) => updateField('quota_days', v)}
                      style={{ width: 120 }}
                    />
                    <span style={{ color: 'var(--semi-color-text-2)', fontSize: 14 }}>天</span>
                  </>
                )}
              </div>
            </div>
          )}
          {(form.package_type || 'subscription') === 'quota' && (
            <>
              <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
                <div style={{ ...labelStyle, paddingTop: 6 }}>商品特性</div>
                <div style={{ ...fieldStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {featureList.map((feat, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Input
                        value={feat}
                        onChange={(v) => updateFeature(idx, v)}
                        placeholder={`特性 ${idx + 1}`}
                        style={{ flex: 1 }}
                      />
                      <Button
                        icon={<X size={14} />}
                        theme="borderless"
                        type="tertiary"
                        onClick={() => removeFeature(idx)}
                      />
                    </div>
                  ))}
                  <Button
                    icon={<Plus size={14} />}
                    theme="borderless"
                    type="primary"
                    onClick={addFeature}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    添加一条
                  </Button>
                </div>
              </div>
              <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
                <div style={{ ...labelStyle, paddingTop: 6 }}>商品说明</div>
                <TextArea
                  value={form.detail}
                  onChange={(v) => updateField('detail', v)}
                  autosize={{ minRows: 3, maxRows: 8 }}
                  placeholder="商品说明（可选）"
                  style={fieldStyle}
                />
              </div>
            </>
          )}
          {(form.package_type || 'subscription') !== 'quota' && (
            <>
              <div style={rowStyle}>
                <div style={labelStyle}>会员身份</div>
                <div style={fieldStyle}>
                  <Select
                    value={form.identity_id || undefined}
                    onChange={(v) => updateField('identity_id', v)}
                    style={{ width: '100%' }}
                    placeholder="选择关联的会员身份"
                    showClear
                    optionList={identities.map((it) => ({ value: it.id, label: it.name }))}
                  />
                </div>
              </div>
              <div style={rowStyle}>
                <div style={labelStyle}>售价（元）</div>
                <InputNumber min={0} precision={2} value={form.price} onChange={(v) => updateField('price', v)} style={fieldStyle} />
              </div>
              <div style={rowStyle}>
                <div style={labelStyle}>原价（元）</div>
                <InputNumber min={0} precision={2} value={form.quota_original_price} onChange={(v) => updateField('quota_original_price', v)} style={fieldStyle} />
              </div>
              <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
                <div style={{ ...labelStyle, paddingTop: 6 }}>商品特性</div>
                <div style={{ ...fieldStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {featureList.map((feat, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Input
                        value={feat}
                        onChange={(v) => updateFeature(idx, v)}
                        placeholder={`特性 ${idx + 1}`}
                        style={{ flex: 1 }}
                      />
                      <Button
                        icon={<X size={14} />}
                        theme="borderless"
                        type="tertiary"
                        onClick={() => removeFeature(idx)}
                      />
                    </div>
                  ))}
                  <Button
                    icon={<Plus size={14} />}
                    theme="borderless"
                    type="primary"
                    onClick={addFeature}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    添加一条
                  </Button>
                </div>
              </div>
              <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
                <div style={{ ...labelStyle, paddingTop: 6 }}>商品说明</div>
                <TextArea
                  value={form.detail}
                  onChange={(v) => updateField('detail', v)}
                  autosize={{ minRows: 3, maxRows: 8 }}
                  placeholder="商品说明（可选）"
                  style={fieldStyle}
                />
              </div>
            </>
          )}
          <div style={rowStyle}>
            <div style={labelStyle}>角标文字（可选）</div>
            <Input value={form.badge} onChange={(v) => updateField('badge', v)} style={fieldStyle} />
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>排序（小在前）</div>
            <InputNumber value={form.sort} onChange={(v) => updateField('sort', v)} style={fieldStyle} />
          </div>
        </div>
      </Spin>
      <ConfigPageFooter
        dirty={dirty}
        loading={loading}
        saveText="保存商品"
        onCancel={handleCancel}
        onSave={() => { handleSave().then(); }}
      />
    </ConfigPageLayout>
  );
};

export default EditProduct;
