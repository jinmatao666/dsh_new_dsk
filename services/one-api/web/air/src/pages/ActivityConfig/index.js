import React, { useEffect, useState, useCallback } from 'react';
import { Button, Table, Tag, Space, Input, Select, DatePicker, Spin, Modal, Typography, Radio, InputNumber, Banner } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { ConfigPageLayout } from '../../components/ConfigPageLayout';
import useColumnConfig from '../../hooks/useColumnConfig';

const emptyForm = {
  id: 0,
  name: '',
  start_time: null,
  end_time: null,
  status: 'draft',
  mechanism_type: 'trigger',
  trigger_type: 'register',
  trigger_config: {},
  grant_limit: 'once',
  grant_role: 'invitee',
  reward_type: 'quota',
  reward_subtype: 'points',
  reward_amount: 0,
  reward_identity_id: null,
  reward_expires_at: null,
  total_budget: null, // 总预算（内部额度），null/0 表示不限
};

const serializeForm = (value) => JSON.stringify(value);

// 积分单位换算:后台运营按「积分数」填写/展示,后端 reward_amount 存「内部额度」(积分 × QuotaPerUnit)。
// 与个人中心、用户管理页的 renderQuota 口径一致,保证「运营填多少积分,用户到账多少积分」。
// 仅 reward_subtype==='points' 需要换算;vip(天)/discount(系数)/deduction(元)语义不同,原样存取。
const getQuotaPerUnit = () => {
  const v = parseFloat(localStorage.getItem('quota_per_unit'));
  return Number.isFinite(v) && v > 0 ? v : 1000;
};
// 内部额度 → 展示积分数(用于回填、列表)
const quotaToPoints = (amount) => Math.round((Number(amount) || 0) / getQuotaPerUnit());
// 展示积分数 → 内部额度(用于保存)
const pointsToQuota = (points) => Math.round((Number(points) || 0) * getQuotaPerUnit());

// discount: UI填0-1系数，存库×10000；deduction: UI填元，存库×100（分）
const discountToAmount = (v) => Math.round((Number(v) || 0) * 10000);
const amountToDiscount = (v) => (Number(v) || 0) / 10000;
const deductionToAmount = (v) => Math.round((Number(v) || 0) * 100);
const amountToDeduction = (v) => (Number(v) || 0) / 100;


const rewardSubtypeConfig = {
  points: { label: '积分数', suffix: '分', min: 0, step: 1, precision: 0 },
  vip: { label: '会员时长', suffix: '天', min: 0, step: 1, precision: 0 },
  discount: { label: '折扣系数', suffix: '（0-1）', min: 0, max: 1, step: 0.01, precision: 2 },
  deduction: { label: '抵扣金额', suffix: '元', min: 0, step: 0.01, precision: 2 },
};

const ActivityConfig = () => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [originForm, setOriginForm] = useState(emptyForm);
  const [identities, setIdentities] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const dirty = serializeForm(form) !== serializeForm(originForm);

  // 活动时间模式：起止时间都为空时视为「不限时」
  const timeMode = !form.start_time && !form.end_time ? 'unlimited' : 'range';
  const rewardConf = rewardSubtypeConfig[form.reward_subtype || 'points'] || rewardSubtypeConfig.points;

  const handleTimeModeChange = (mode) => {
    if (mode === 'unlimited') {
      setForm({ ...form, start_time: null, end_time: null });
    } else {
      // 切到区间时给一个默认起始时间，避免与「不限时」无法区分
      setForm({ ...form, start_time: form.start_time || new Date().toISOString() });
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/activity/');
      if (res.data.success) setActivities(res.data.data || []);
      else showError(res.data.message);
    } catch (e) {
      showError('加载失败');
    }
    // 独立加载身份列表，失败不影响活动列表
    try {
      const idRes = await API.get('/api/member-identity/');
      if (idRes.data.success) setIdentities(idRes.data.data || []);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    const newForm = { ...emptyForm };
    setForm(newForm);
    setOriginForm(newForm);
    setShowEdit(true);
  };

  const openEdit = (record) => {
    const next = { ...record };
    const subtype = record.reward_subtype || 'points';
    if (subtype === 'points') {
      next.reward_amount = quotaToPoints(record.reward_amount);
      // 总预算对积分活动也按积分展示（存库为内部额度）
      if (record.total_budget != null && record.total_budget > 0) {
        next.total_budget = quotaToPoints(record.total_budget);
      }
    } else if (subtype === 'discount') {
      next.reward_amount = amountToDiscount(record.reward_amount);
    } else if (subtype === 'deduction' && record.reward_type === 'coupon') {
      next.reward_amount = amountToDeduction(record.reward_amount);
    }
    setForm(next);
    setOriginForm(next);
    setShowEdit(true);
  };

  const handleCancel = () => {
    setForm(originForm);
  };

  const handleSave = async (isDraft = true) => {
    if (!form.name) {
      showError('活动名称不能为空');
      return;
    }
    const { trigger_config, ...rest } = form;
    const subtype = form.reward_subtype || 'points';
    let encodedAmount = form.reward_amount;
    if (subtype === 'points') {
      encodedAmount = pointsToQuota(form.reward_amount);
    } else if (subtype === 'discount') {
      encodedAmount = discountToAmount(form.reward_amount);
    } else if (subtype === 'deduction' && form.reward_type === 'coupon') {
      encodedAmount = deductionToAmount(form.reward_amount);
    }
    const payload = {
      ...rest,
      status: isDraft ? 'draft' : 'active',
      reward_amount: encodedAmount,
      // 总预算：null/0 表示不限；积分活动填的是积分数，存库需换算为内部额度
      total_budget:
        form.total_budget == null || form.total_budget === ''
          ? null
          : subtype === 'points'
            ? pointsToQuota(form.total_budget)
            : Number(form.total_budget),
      // Go 模型中 trigger_config 为 JSON 字符串
      trigger_config:
        typeof trigger_config === 'string'
          ? trigger_config
          : JSON.stringify(trigger_config || {}),
    };
    const submit = async (extra = {}) => {
      const body = { ...payload, ...extra };
      return form.id ? await API.put('/api/activity/', body) : await API.post('/api/activity/', body);
    };
    try {
      const res = await submit();
      if (res.data.success) {
        showSuccess(form.id ? '已更新' : '已创建');
        setShowEdit(false);
        load();
      } else if (res.data.conflict) {
        // 同类活动冲突：弹管理员密码二次确认后强制保存
        promptAdminPasswordAndResubmit(res.data.message, async (pwd) => {
          const res2 = await submit({ admin_password: pwd });
          if (res2.data.success) {
            showSuccess(form.id ? '已更新' : '已创建');
            setShowEdit(false);
            load();
            return true;
          }
          showError(res2.data.message);
          return false;
        });
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('保存失败');
    }
  };

  // 冲突二次确认：弹出输入管理员密码的 Modal，确认后调用 resubmit(pwd)。
  // resubmit 返回 true 表示成功（关闭弹窗），false 表示失败（保留弹窗让用户重试）。
  const promptAdminPasswordAndResubmit = (message, resubmit) => {
    let pwd = '';
    Modal.confirm({
      title: '存在同类活动，需管理员确认',
      content: (
        <div>
          <Typography.Paragraph type="warning" style={{ marginBottom: 12 }}>
            {message}
          </Typography.Paragraph>
          <Input
            mode="password"
            placeholder="请输入管理员密码"
            onChange={(v) => {
              pwd = v;
            }}
          />
        </div>
      ),
      okText: '确认继续',
      cancelText: '取消',
      onOk: async () => {
        if (!pwd) {
          showError('请输入管理员密码');
          return Promise.reject(new Error('empty password'));
        }
        const ok = await resubmit(pwd);
        if (!ok) return Promise.reject(new Error('resubmit failed'));
      },
    });
  };

  const handleDelete = (record) => {
    if (record.status === 'active') {
      Modal.warning({
        title: '无法删除',
        content: '该活动正在进行中，请先下架后再删除',
      });
      return;
    }
    Modal.confirm({
      title: '删除活动',
      content: `确定删除「${record.name}」？`,
      onOk: async () => {
        const res = await API.delete(`/api/activity/${record.id}`);
        if (res.data.success) {
          showSuccess('已删除');
          load();
        } else {
          showError(res.data.message);
        }
      },
    });
  };

  const handleStatusChange = (record, newStatus) => {
    const isPublish = newStatus === 'active';
    Modal.confirm({
      title: isPublish ? '确认发布' : '确认下架',
      content: isPublish
        ? `发布后「${record.name}」将对用户生效，确认发布？`
        : `下架后「${record.name}」将停止对用户生效，确认下架？`,
      okText: isPublish ? '发布' : '下架',
      okType: isPublish ? 'primary' : 'danger',
      onOk: async () => {
        try {
          const res = await API.put('/api/activity/', { ...record, status: newStatus });
          if (res.data.success) {
            showSuccess('状态已更新');
            load();
          } else if (res.data.conflict) {
            promptAdminPasswordAndResubmit(res.data.message, async (pwd) => {
              const res2 = await API.put('/api/activity/', { ...record, status: newStatus, admin_password: pwd });
              if (res2.data.success) {
                showSuccess('状态已更新');
                load();
                return true;
              }
              showError(res2.data.message);
              return false;
            });
          } else {
            showError(res.data.message);
          }
        } catch (e) {
          showError('更新失败');
        }
      },
    });
  };

  const updateField = (field, value) => {
    setForm({ ...form, [field]: value });
  };

  const handleBatchDelete = () => {
    const activeOnes = activities.filter(a => selectedRowKeys.includes(a.id) && a.status === 'active');
    if (activeOnes.length > 0) {
      Modal.warning({
        title: '无法删除',
        content: `有 ${activeOnes.length} 个活动正在进行中，请先下架后再删除`,
      });
      return;
    }
    Modal.confirm({
      title: '批量删除',
      content: `确定删除已选的 ${selectedRowKeys.length} 个活动？`,
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => API.delete(`/api/activity/${id}`)));
          showSuccess('已删除');
          setSelectedRowKeys([]);
          load();
        } catch (e) {
          showError('部分删除失败');
          load();
        }
      },
    });
  };

  const handleBatchStatus = (newStatus) => {
    const label = newStatus === 'active' ? '发布' : '下架';
    const targets = activities.filter(a => selectedRowKeys.includes(a.id) && a.status !== newStatus);
    if (targets.length === 0) {
      showSuccess(`所选条目均已${label}`);
      return;
    }
    Modal.confirm({
      title: `批量${label}`,
      content: `将${label} ${targets.length} 个活动（已${label}的条目自动跳过）`,
      okText: label,
      onOk: async () => {
        try {
          await Promise.all(targets.map(a => API.put('/api/activity/', { ...a, status: newStatus })));
          showSuccess(`已${label}`);
          setSelectedRowKeys([]);
          load();
        } catch (e) {
          showError('部分操作失败');
          load();
        }
      },
    });
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '活动机制',
      dataIndex: 'mechanism_type',
      width: 100,
      render: (v) => {
        const mechanismMap = {
          trigger: { color: 'blue', text: '事件触发' },
          crowd: { color: 'purple', text: '人群定向' },
        };
        const mechanism = mechanismMap[v] || { color: 'grey', text: v };
        return <Tag color={mechanism.color}>{mechanism.text}</Tag>;
      },
    },
    {
      title: '触发/发放方式',
      key: 'trigger_dispatch',
      width: 140,
      render: (text, record) => {
        if (record.mechanism_type === 'trigger') {
          const triggerMap = {
            register: '注册时',
            login: '登录时',
            first_request: '用户请求',
            manual: '手动发放',
            invite_registration: '邀请注册',
            invite_payment: '邀请付费',
            redeem: '兑换码兑换',
          };
          return triggerMap[record.trigger_type] || record.trigger_type;
        }
        return '-';
      },
    },
    {
      title: '奖励信息',
      key: 'reward_info',
      width: 180,
      render: (text, record) => {
        const rewardTypeMap = {
          quota: '额度',
          vip: 'VIP',
          coupon: '优惠券',
        };
        const type = rewardTypeMap[record.reward_type] || record.reward_type;
        // points 类型:库里是内部额度,列表按积分数展示,与编辑/个人中心口径一致
        const subtype = record.reward_subtype || 'points';
        if (subtype === 'points') {
          return `${type} ${quotaToPoints(record.reward_amount)} 分`;
        }
        if (subtype === 'discount') {
          return `${type} 折扣${amountToDiscount(record.reward_amount)}`;
        }
        if (subtype === 'deduction' && record.reward_type === 'coupon') {
          return `${type} ¥${amountToDeduction(record.reward_amount)}`;
        }
        return `${type} ${record.reward_amount || 0}`;
      },
    },
    {
      title: '预算',
      key: 'budget',
      width: 140,
      render: (text, record) => {
        // total_budget 为 null/0 表示不限预算
        if (record.total_budget == null || record.total_budget === 0) {
          return <span style={{ color: 'var(--semi-color-text-2)' }}>不限</span>;
        }
        const subtype = record.reward_subtype || 'points';
        const fmt = (v) => (subtype === 'points' ? `${quotaToPoints(v)} 分` : v);
        const used = record.used_budget || 0;
        const exhausted = used >= record.total_budget;
        return (
          <span style={{ color: exhausted ? 'var(--semi-color-danger)' : undefined }}>
            {fmt(used)} / {fmt(record.total_budget)}
            {exhausted && '（已用完）'}
          </span>
        );
      },
    },
    {
      title: '有效期',
      key: 'valid_period',
      width: 200,
      render: (text, record) => (
        <div>
          {record.start_time ? new Date(record.start_time).toLocaleDateString() : '-'} 至{' '}
          {record.end_time ? new Date(record.end_time).toLocaleDateString() : '-'}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => {
        const statusMap = {
          draft: { color: 'grey', text: '草稿' },
          active: { color: 'green', text: '进行中' },
          paused: { color: 'orange', text: '已暂停' },
          ended: { color: 'red', text: '已结束' },
        };
        const status = statusMap[v] || { color: 'grey', text: v };
        return <Tag color={status.color}>{status.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 220,
      render: (text, record) => (
        <Space>
          <Button size="small" theme="borderless" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" theme="borderless" type="danger" onClick={() => handleDelete(record)}>
            删除
          </Button>
          {record.status === 'active' ? (
            <Button size="small" theme="borderless" onClick={() => handleStatusChange(record, 'paused')}>
              下架
            </Button>
          ) : record.status === 'draft' || record.status === 'paused' ? (
            <Button size="small" theme="borderless" onClick={() => handleStatusChange(record, 'active')}>
              发布
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'activity_table_visible_columns',
    columnMeta: [
      { key: 'name', label: '名称', always: true },
      { key: 'mechanism_type', label: '活动机制' },
      { key: 'trigger_dispatch', label: '触发/发放方式' },
      { key: 'reward_info', label: '奖励信息' },
      { key: 'valid_period', label: '有效期' },
      { key: 'status', label: '状态' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 14,
  };
  const labelStyle = {
    width: 120,
    flexShrink: 0,
    color: 'var(--semi-color-text-0)',
    fontSize: 14,
  };

  const fieldStyle = {
    flex: 1,
  };

  // 编辑页面
  if (showEdit) {
    return (
      <ConfigPageLayout>
        <div className="config-page-topbar">
          <Button
            icon={<IconArrowLeft />}
            theme="borderless"
            type="tertiary"
            onClick={() => setShowEdit(false)}
          >
            返回
          </Button>
          <Typography.Title heading={5} style={{ margin: 0 }}>
            {form.id ? '编辑活动' : '新建活动'}
          </Typography.Title>
        </div>

        <Spin spinning={loading}>
          <div style={{ maxWidth: 800 }}>
            {/* 名称 */}
            <div style={rowStyle}>
              <div style={labelStyle}>名称</div>
              <Input
                value={form.name}
                onChange={(v) => updateField('name', v)}
                placeholder="请输入活动名称"
                style={fieldStyle}
              />
            </div>

            {/* 活动类型 */}
            <div style={rowStyle}>
              <div style={labelStyle}>活动类型</div>
              <Radio.Group
                value={form.mechanism_type}
                onChange={(e) => updateField('mechanism_type', e.target.value)}
                type="button"
                style={fieldStyle}
              >
                <Radio value="trigger">事件触发</Radio>
                <Radio value="crowd" disabled>人群定向</Radio>
              </Radio.Group>
            </div>

            {/* 触发事件 */}
            <div style={rowStyle}>
              <div style={labelStyle}>触发事件</div>
              <Select
                value={form.trigger_type}
                onChange={(v) => {
                  const isDualRole = v === 'invite_registration' || v === 'invite_payment' || v === 'redeem';
                  setForm({
                    ...form,
                    trigger_type: v,
                    grant_role: isDualRole ? (form.grant_role || 'invitee') : 'invitee',
                    reward_subtype: v === 'invite_payment' ? (form.reward_subtype || 'points') : form.reward_subtype,
                  });
                }}
                style={fieldStyle}
              >
                <Select.Option value="register">用户注册</Select.Option>
                <Select.Option value="login">用户登录</Select.Option>
                <Select.Option value="first_request">用户请求</Select.Option>
                <Select.Option value="manual">手动领取</Select.Option>
                <Select.Option value="invite_registration">邀请注册</Select.Option>
                <Select.Option value="invite_payment">邀请付费</Select.Option>
                <Select.Option value="redeem">兑换码兑换</Select.Option>
              </Select>
            </div>

            {/* 邀请/兑换触发：奖励角色 */}
            {(form.trigger_type === 'invite_registration' || form.trigger_type === 'invite_payment' || form.trigger_type === 'redeem') && (
              <div style={rowStyle}>
                <div style={labelStyle}>奖励角色</div>
                <Radio.Group
                  value={form.grant_role || 'invitee'}
                  onChange={(e) => updateField('grant_role', e.target.value)}
                  type="button"
                  style={fieldStyle}
                >
                  {form.trigger_type === 'redeem' ? (
                    <>
                      <Radio value="invitee">兑换人</Radio>
                      <Radio value="inviter">发码人</Radio>
                    </>
                  ) : (
                    <>
                      <Radio value="invitee">被邀请人</Radio>
                      <Radio value="inviter">邀请人</Radio>
                    </>
                  )}
                </Radio.Group>
              </div>
            )}

            {/* 活动时间 */}
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={{ ...labelStyle, paddingTop: 6 }}>活动时间</div>
              <div style={fieldStyle}>
                <Radio.Group
                  value={timeMode}
                  onChange={(e) => handleTimeModeChange(e.target.value)}
                  type="button"
                >
                  <Radio value="range">区间</Radio>
                  <Radio value="unlimited">不限时</Radio>
                </Radio.Group>
                {timeMode === 'range' && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DatePicker
                      value={form.start_time ? new Date(form.start_time) : null}
                      onChange={(date) => updateField('start_time', date ? date.toISOString() : null)}
                      type="dateTime"
                      placeholder="开始时间"
                      style={{ flex: 1 }}
                    />
                    <span style={{ color: 'var(--semi-color-text-2)' }}>至</span>
                    <DatePicker
                      value={form.end_time ? new Date(form.end_time) : null}
                      onChange={(date) => updateField('end_time', date ? date.toISOString() : null)}
                      type="dateTime"
                      placeholder="结束时间"
                      style={{ flex: 1 }}
                    />
                  </div>
                )}
              </div>
            </div>

            {form.trigger_type === 'manual' && (
              <div style={{ marginBottom: 16, marginLeft: 136 }}>
                <Banner
                  type="info"
                  description="用户需要在活动页面手动点击领取按钮"
                  closeIcon={null}
                />
              </div>
            )}

            {/* 发放类型 */}
            <div style={rowStyle}>
              <div style={labelStyle}>发放类型</div>
              <Radio.Group
                value={form.reward_type}
                onChange={(e) => {
                  const newType = e.target.value;
                  const defaultSubtype = newType === 'coupon' ? 'discount' : 'points';
                  setForm({ ...form, reward_type: newType, reward_subtype: defaultSubtype, reward_amount: 0 });
                }}
                type="button"
                style={fieldStyle}
              >
                <Radio value="quota">权益发放</Radio>
                <Radio value="coupon">优惠券</Radio>
              </Radio.Group>
            </div>

            {/* 权益类型 / 优惠券类型 */}
            <div style={rowStyle}>
              <div style={labelStyle}>{form.reward_type === 'coupon' ? '优惠券类型' : '权益类型'}</div>
              <Radio.Group
                value={form.reward_subtype || (form.reward_type === 'coupon' ? 'discount' : 'points')}
                onChange={(e) => updateField('reward_subtype', e.target.value)}
                type="button"
                style={fieldStyle}
              >
                {form.reward_type === 'coupon' ? (
                  <>
                    <Radio value="discount">折扣</Radio>
                    <Radio value="deduction">抵扣</Radio>
                  </>
                ) : form.trigger_type === 'invite_payment' ? (
                  <>
                    <Radio value="points">积分</Radio>
                    <Radio value="vip">会员时长</Radio>
                    <Radio value="deduction">价格抵扣</Radio>
                  </>
                ) : (
                  <>
                    <Radio value="points">积分</Radio>
                    <Radio value="vip">会员时长</Radio>
                  </>
                )}
              </Radio.Group>
            </div>

            {/* 奖励数量 —— 随权益类型变化 */}
            <div style={rowStyle}>
              <div style={labelStyle}>{rewardConf.label}</div>
              <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <InputNumber
                  value={form.reward_amount}
                  onChange={(v) => updateField('reward_amount', v)}
                  min={rewardConf.min}
                  max={rewardConf.max}
                  step={rewardConf.step}
                  precision={rewardConf.precision}
                  style={{ flex: 1 }}
                  placeholder={`请输入${rewardConf.label}`}
                />
                <span style={{ fontSize: 14, color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap' }}>
                  {rewardConf.suffix}
                </span>
              </div>
            </div>

            {/* vip 类型：选择会员身份 */}
            {form.reward_subtype === 'vip' && (
              <div style={rowStyle}>
                <div style={labelStyle}>会员身份</div>
                <Select
                  value={form.reward_identity_id}
                  onChange={(v) => updateField('reward_identity_id', v)}
                  style={fieldStyle}
                  placeholder="请选择会员身份"
                  optionList={identities.filter(i => i.enabled).map(i => ({ value: i.id, label: i.name }))}
                />
              </div>
            )}

            {/* 权益期限（积分和优惠券可设置） */}
            {(form.reward_subtype === 'points' || form.reward_type === 'coupon') && (
              <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
                <div style={{ ...labelStyle, paddingTop: 6 }}>权益期限</div>
                <div style={fieldStyle}>
                  <Radio.Group
                    value={form.reward_expires_at ? 'expires' : 'unlimited'}
                    onChange={(e) => {
                      if (e.target.value === 'unlimited') {
                        updateField('reward_expires_at', null);
                      } else {
                        updateField('reward_expires_at', form.reward_expires_at || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString());
                      }
                    }}
                    type="button"
                  >
                    <Radio value="unlimited">不限时</Radio>
                    <Radio value="expires">到期时间</Radio>
                  </Radio.Group>
                  {form.reward_expires_at && (
                    <div style={{ marginTop: 12 }}>
                      <DatePicker
                        value={new Date(form.reward_expires_at)}
                        onChange={(date) => updateField('reward_expires_at', date ? date.toISOString() : null)}
                        type="dateTime"
                        placeholder="选择到期时间"
                        style={{ width: 240 }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 账号限制 */}
            <div style={rowStyle}>
              <div style={labelStyle}>账号限制</div>
              <Radio.Group
                value={form.grant_limit}
                onChange={(e) => updateField('grant_limit', e.target.value)}
                type="button"
                style={fieldStyle}
              >
                <Radio value="once">限一次</Radio>
                <Radio value="daily">每日一次</Radio>
                <Radio value="unlimited">不限次数</Radio>
              </Radio.Group>
            </div>

            {/* 总预算 —— null/0 表示不限，达到上限后活动自动停止发放 */}
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={{ ...labelStyle, paddingTop: 6 }}>总预算</div>
              <div style={fieldStyle}>
                <Radio.Group
                  value={form.total_budget == null || form.total_budget === '' ? 'unlimited' : 'limited'}
                  onChange={(e) => {
                    if (e.target.value === 'unlimited') {
                      updateField('total_budget', null);
                    } else {
                      updateField('total_budget', form.total_budget || 0);
                    }
                  }}
                  type="button"
                >
                  <Radio value="unlimited">不限</Radio>
                  <Radio value="limited">限额</Radio>
                </Radio.Group>
                {form.total_budget != null && form.total_budget !== '' && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <InputNumber
                      value={form.total_budget}
                      onChange={(v) => updateField('total_budget', v)}
                      min={0}
                      step={rewardConf.step}
                      precision={rewardConf.precision}
                      style={{ width: 240 }}
                      placeholder="活动累计发放上限"
                    />
                    <span style={{ fontSize: 14, color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap' }}>
                      {rewardConf.suffix}
                    </span>
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                  不限时活动累计发放无上限；限额达到上限后自动停止发放（签到类活动建议选「不限」）。
                </div>
              </div>
            </div>
          </div>
        </Spin>

        <div className={`config-footer-bar${dirty ? ' is-dirty' : ''}`}>
          <span className="config-footer-hint">
            {dirty ? '有未保存的修改' : '所有修改已保存'}
          </span>
          <div className="config-footer-actions">
            <Button
              type="button"
              disabled={!dirty || loading}
              onClick={handleCancel}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!dirty || loading}
              onClick={() => handleSave(true)}
            >
              保存草稿
            </Button>
            <Button
              theme="solid"
              type="primary"
              disabled={!dirty}
              onClick={() => {
                Modal.confirm({
                  title: '确认发布',
                  content: '发布后活动将对用户生效，确认发布？',
                  okText: '发布',
                  onOk: () => handleSave(false),
                });
              }}
            >
              发布
            </Button>
          </div>
        </div>
      </ConfigPageLayout>
    );
  }

  // 列表页面
  return (
    <div style={{ padding: 0 }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button theme="solid" onClick={openCreate}>
          新建活动
        </Button>
        {selectedRowKeys.length > 0 && (
          <>
            <span style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>
              已选 {selectedRowKeys.length} 项
            </span>
            <Button size="small" onClick={() => handleBatchStatus('active')}>批量发布</Button>
            <Button size="small" onClick={() => handleBatchStatus('paused')}>批量下架</Button>
            <Button size="small" type="danger" onClick={handleBatchDelete}>批量删除</Button>
          </>
        )}
        <div style={{ marginLeft: 'auto' }}>{columnConfigButton}</div>
      </div>
      <Table
        columns={visibleColumns}
        dataSource={activities}
        loading={loading}
        rowKey="id"
        pagination={false}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
      />
    </div>
  );
};

export default ActivityConfig;
