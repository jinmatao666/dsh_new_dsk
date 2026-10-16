import React, { useEffect, useState, useCallback } from 'react';
import { Button, Table, Tag, Space, Input, Select, Modal, Typography, InputNumber, Banner, Spin, DatePicker, Tooltip } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconDelete, IconEyeOpened, IconSearch } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Text } = Typography;

const emptyForm = {
  id: 0,
  name: '',
  description: '',
  rules: {
    conditions: [],
    logic: 'AND',
  },
  is_dynamic: true,
};

const FIELD_OPTIONS = [
  { value: 'created_at', label: '注册时间', type: 'datetime' },
  { value: 'last_active_at', label: '最近活跃时间', type: 'datetime' },
  { value: 'purchase_time', label: '购买时间', type: 'datetime' },
  { value: 'purchase_count', label: '购买次数', type: 'number' },
  { value: 'used_quota', label: '已消费积分', type: 'number' },
  { value: 'quota', label: '当前积分余额', type: 'number' },
  { value: 'request_count', label: '请求次数', type: 'number' },
  { value: 'account_type', label: '用户类型', type: 'enum' },
  { value: 'status', label: '账户状态', type: 'enum' },
];

const OPERATOR_OPTIONS = {
  datetime: [
    { value: '>', label: '>' },
    { value: '<', label: '<' },
    { value: '>=', label: '>=' },
    { value: '<=', label: '<=' },
    { value: 'between', label: '介于' },
  ],
  number: [
    { value: '>', label: '>' },
    { value: '<', label: '<' },
    { value: '>=', label: '>=' },
    { value: '<=', label: '<=' },
    { value: '=', label: '=' },
    { value: '!=', label: '!=' },
    { value: 'between', label: '介于' },
  ],
  enum: [
    { value: '=', label: '=' },
    { value: '!=', label: '!=' },
    { value: 'in', label: '包含于' },
  ],
};

const SPECIAL_VALUES = [
  { value: 'today', label: '今天', days: 0 },
  { value: '7_days_ago', label: '7天前', days: 7 },
  { value: '30_days_ago', label: '30天前', days: 30 },
  { value: 'this_month', label: '本月', days: null },
];

// 时间条件的人话解释：> / >= 表示"最近 N 天内"，< / <= 表示"超过 N 天以上"
const describeTimeCondition = (field, operator, special) => {
  if (!special || special.days == null) return '';
  const subject = field === 'last_active_at'
    ? '最近活跃'
    : field === 'created_at'
      ? '注册'
      : field === 'purchase_time'
        ? '最近购买'
        : '';
  const n = special.days;
  if (operator === '>' || operator === '>=') {
    return n === 0 ? `${subject}时间在今天之内` : `${subject}在最近 ${n} 天内`;
  }
  if (operator === '<' || operator === '<=') {
    return n === 0 ? `${subject}时间早于今天` : `${subject}已超过 ${n} 天以上`;
  }
  return '';
};

const USER_TYPE_OPTIONS = [
  { value: 1, label: '个人用户' },
  { value: 2, label: '企业用户' },
];

const STATUS_OPTIONS = [
  { value: 1, label: '正常' },
  { value: 2, label: '已禁用' },
];

// 把单个规则条件渲染成可读文本
const formatCondition = (cond) => {
  const fieldLabel = FIELD_OPTIONS.find((f) => f.value === cond.field)?.label || cond.field;
  const fieldType = FIELD_OPTIONS.find((f) => f.value === cond.field)?.type;
  const opLabel = (OPERATOR_OPTIONS[fieldType] || []).find((o) => o.value === cond.operator)?.label || cond.operator;

  const labelOf = (v) => {
    if (fieldType === 'enum') {
      const opts = cond.field === 'account_type' ? USER_TYPE_OPTIONS : STATUS_OPTIONS;
      return opts.find((o) => o.value === v)?.label ?? String(v);
    }
    if (fieldType === 'datetime') {
      return SPECIAL_VALUES.find((o) => o.value === v)?.label ?? String(v);
    }
    return String(v);
  };

  let valueText;
  if (Array.isArray(cond.value)) {
    valueText = cond.value.map(labelOf).join(cond.operator === 'between' ? ' ~ ' : ', ');
  } else if (fieldType === 'datetime' && cond.operator === 'between' && typeof cond.value === 'string') {
    valueText = cond.value.split(',').filter(Boolean).join(' ~ ');
  } else {
    valueText = labelOf(cond.value);
  }

  return `${fieldLabel} ${opLabel} ${valueText}`;
};

const UserCrowdConfig = () => {
  const [crowds, setCrowds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // 内联预览（保存前，按规则）
  const [previewUsers, setPreviewUsers] = useState([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewed, setPreviewed] = useState(false);

  // 列表项查看分群规则
  const [viewVisible, setViewVisible] = useState(false);
  const [viewRecord, setViewRecord] = useState(null);

  const loadCrowds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/user-crowd/');
      if (res.data.success) {
        setCrowds(res.data.data || []);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('获取分群列表失败');
      console.error('加载分群失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCrowds();
  }, [loadCrowds]);

  const resetForm = () => {
    setForm(emptyForm);
    setPreviewUsers([]);
    setPreviewTotal(0);
    setPreviewed(false);
  };

  const validateRules = () => {
    if (!form.rules.conditions || form.rules.conditions.length === 0) {
      showError('请至少添加一个条件');
      return false;
    }
    return true;
  };

  const handlePreview = async () => {
    if (!validateRules()) return;
    setPreviewLoading(true);
    try {
      const res = await API.post('/api/user-crowd/preview', {
        rules: JSON.stringify(form.rules),
        page: 1,
        page_size: 20,
      });
      if (res.data.success) {
        setPreviewUsers(res.data.data || []);
        setPreviewTotal(res.data.total || 0);
        setPreviewed(true);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('预览失败');
      console.error('预览分群失败:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name) {
      showError('分群名称不能为空');
      return;
    }
    if (!validateRules()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        rules: JSON.stringify(form.rules),
      };
      const res = await API.post('/api/user-crowd/', payload);
      if (res.data.success) {
        showSuccess('创建成功');
        resetForm();
        loadCrowds();
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('保存失败');
      console.error('保存分群失败:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (record) => {
    Modal.confirm({
      title: '删除分群',
      content: `确定删除分群「${record.name}」？`,
      onOk: async () => {
        try {
          const res = await API.delete(`/api/user-crowd/${record.id}`);
          if (res.data.success) {
            showSuccess('删除成功');
            loadCrowds();
          } else {
            showError(res.data.message);
          }
        } catch (error) {
          showError('删除失败');
          console.error('删除分群失败:', error);
        }
      },
    });
  };

  const handleRefreshCount = async (id) => {
    try {
      const res = await API.post(`/api/user-crowd/${id}/calculate`);
      if (res.data.success) {
        showSuccess('刷新成功');
        loadCrowds();
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('刷新失败');
      console.error('刷新人数失败:', error);
    }
  };

  const [refreshingAll, setRefreshingAll] = useState(false);
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      const res = await API.post('/api/user-crowd/calculate-all');
      if (res.data.success) {
        const { ok = 0, fail = 0 } = res.data.data || {};
        showSuccess(fail > 0 ? `刷新完成：成功 ${ok} 个，失败 ${fail} 个` : `刷新完成：${ok} 个分群`);
        loadCrowds();
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('刷新失败');
      console.error('批量刷新人数失败:', error);
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleViewRules = (record) => {
    const parsed = typeof record.rules === 'string' ? JSON.parse(record.rules) : record.rules;
    setViewRecord({ ...record, parsedRules: parsed || { conditions: [], logic: 'AND' } });
    setViewVisible(true);
  };

  const addCondition = () => {
    setForm({
      ...form,
      rules: {
        ...form.rules,
        conditions: [
          ...form.rules.conditions,
          { field: 'account_type', operator: '=', value: '', description: '' },
        ],
      },
    });
  };

  const removeCondition = (index) => {
    const newConditions = [...form.rules.conditions];
    newConditions.splice(index, 1);
    setForm({
      ...form,
      rules: { ...form.rules, conditions: newConditions },
    });
  };

  const updateCondition = (index, field, value) => {
    const newConditions = [...form.rules.conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };

    // 当字段改变时，重置操作符和值
    if (field === 'field') {
      const fieldConfig = FIELD_OPTIONS.find((opt) => opt.value === value);
      const operators = OPERATOR_OPTIONS[fieldConfig?.type] || [];
      newConditions[index].operator = operators[0]?.value || '=';
      newConditions[index].value = '';
    }

    // between 与其它操作符的值结构不同（区间 vs 单值），切换时重置避免脏值
    if (field === 'operator') {
      const prevOp = form.rules.conditions[index]?.operator;
      if ((prevOp === 'between') !== (value === 'between')) {
        newConditions[index].value = '';
        newConditions[index].customMode = false;
      }
    }

    setForm({
      ...form,
      rules: { ...form.rules, conditions: newConditions },
    });
  };

  const renderValueInput = (condition, index) => {
    const fieldConfig = FIELD_OPTIONS.find((opt) => opt.value === condition.field);
    const fieldType = fieldConfig?.type;

    if (fieldType === 'datetime') {
      // 「介于」：纯自定义起止时间，不提供预设项
      if (condition.operator === 'between') {
        const rangeValue = typeof condition.value === 'string' && condition.value.includes(',')
          ? condition.value.split(',')
          : [];
        return (
          <DatePicker
            type="dateTimeRange"
            value={rangeValue.length === 2 ? rangeValue : undefined}
            onChange={(_, dateStrArr) => {
              const arr = Array.isArray(dateStrArr) ? dateStrArr : [];
              updateCondition(index, 'value', arr.filter(Boolean).join(','));
            }}
            format="yyyy-MM-dd HH:mm:ss"
            style={{ width: 360 }}
            placeholder={['开始时间', '结束时间']}
          />
        );
      }
      const isSpecial = SPECIAL_VALUES.some((opt) => opt.value === condition.value);
      const isCustomMode = condition.customMode || (condition.value && !isSpecial);
      const onModeChange = (v) => {
        if (v === '__custom__') {
          updateCondition(index, 'customMode', true);
        } else {
          const newConditions = [...form.rules.conditions];
          newConditions[index] = { ...newConditions[index], value: v, customMode: false };
          setForm({ ...form, rules: { ...form.rules, conditions: newConditions } });
        }
      };
      return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            value={isCustomMode ? '__custom__' : condition.value}
            onChange={onModeChange}
            style={{ width: 130 }}
            placeholder="选择时间"
            optionList={[
              ...SPECIAL_VALUES.map((opt) => ({ value: opt.value, label: opt.label })),
              { value: '__custom__', label: '自定义' },
            ]}
            renderOptionItem={(renderProps) => {
              const { value, label, focused, selected, onClick, onMouseEnter, style } = renderProps;
              const opt = SPECIAL_VALUES.find((o) => o.value === value);
              const tip = opt ? describeTimeCondition(condition.field, condition.operator, opt) : '';
              const item = (
                <div
                  role="option"
                  aria-selected={selected}
                  onClick={onClick}
                  onMouseEnter={onMouseEnter}
                  style={{
                    ...style,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    background: focused ? 'var(--semi-color-fill-0)' : 'transparent',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {label}
                </div>
              );
              return tip ? (
                <Tooltip key={value} content={tip} position="right" mouseEnterDelay={100} zIndex={2000}>
                  {item}
                </Tooltip>
              ) : (
                <div key={value}>{item}</div>
              );
            }}
          />
          {isCustomMode && (
            <DatePicker
              type="dateTime"
              value={isSpecial ? undefined : condition.value}
              onChange={(_, dateStr) => updateCondition(index, 'value', dateStr)}
              format="yyyy-MM-dd HH:mm:ss"
              style={{ width: 200 }}
              placeholder="选择日期时间"
            />
          )}
        </div>
      );
    }

    if (fieldType === 'enum') {
      const options = condition.field === 'account_type' ? USER_TYPE_OPTIONS : STATUS_OPTIONS;
      if (condition.operator === 'in') {
        return (
          <Select
            multiple
            value={Array.isArray(condition.value) ? condition.value : []}
            onChange={(v) => updateCondition(index, 'value', v)}
            style={{ width: 200 }}
            placeholder="选择值"
          >
            {options.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>
        );
      }
      return (
        <Select
          value={condition.value}
          onChange={(v) => updateCondition(index, 'value', v)}
          style={{ width: 150 }}
          placeholder="选择值"
        >
          {options.map((opt) => (
            <Select.Option key={opt.value} value={opt.value}>
              {opt.label}
            </Select.Option>
          ))}
        </Select>
      );
    }

    // number 类型
    if (condition.operator === 'between') {
      const [min, max] = Array.isArray(condition.value) ? condition.value : [0, 0];
      return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <InputNumber
            value={min}
            onChange={(v) => updateCondition(index, 'value', [v, max])}
            style={{ width: 120 }}
            placeholder="最小值"
          />
          <span>至</span>
          <InputNumber
            value={max}
            onChange={(v) => updateCondition(index, 'value', [min, v])}
            style={{ width: 120 }}
            placeholder="最大值"
          />
        </div>
      );
    }

    return (
      <InputNumber
        value={condition.value}
        onChange={(v) => updateCondition(index, 'value', v)}
        style={{ width: 150 }}
        placeholder="输入值"
      />
    );
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '分群名称', dataIndex: 'name', width: 160 },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (v) => v || '-' },
    {
      title: '类型',
      dataIndex: 'is_dynamic',
      width: 90,
      render: (v) => (
        <Tag color={v ? 'blue' : 'grey'}>{v ? '动态' : '静态'}</Tag>
      ),
    },
    {
      title: '用户数量',
      dataIndex: 'user_count',
      width: 120,
      render: (v, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Text>{v || 0} 人</Text>
          <Button
            size="small"
            theme="borderless"
            icon={<IconRefresh />}
            onClick={() => handleRefreshCount(record.id)}
          />
        </div>
      ),
    },
    {
      title: '操作',
      width: 150,
      render: (text, record) => (
        <Space>
          <Button
            size="small"
            theme="borderless"
            icon={<IconEyeOpened />}
            onClick={() => handleViewRules(record)}
          >
            查看
          </Button>
          <Button
            size="small"
            theme="borderless"
            type="danger"
            icon={<IconDelete />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const userColumns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username', width: 150 },
    { title: '用户类型', dataIndex: 'account_type', width: 100, render: (v) => (v === 2 ? '企业用户' : '个人用户') },
    { title: '注册时间', dataIndex: 'created_at', width: 180, render: (v) => new Date(v).toLocaleString() },
  ];

  const { visibleColumns: crowdVisibleColumns, columnConfigButton: crowdColumnConfigButton } = useColumnConfig({
    storageKey: 'usercrowd_table_visible_columns',
    columnMeta: [
      { key: 'id', label: 'ID', always: true },
      { key: 'name', label: '分群名称' },
      { key: 'description', label: '描述' },
      { key: 'is_dynamic', label: '类型' },
      { key: 'user_count', label: '用户数量' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: userVisibleColumns, columnConfigButton: userColumnConfigButton } = useColumnConfig({
    storageKey: 'usercrowd_preview_table_visible_columns',
    columnMeta: [
      { key: 'id', label: 'ID', always: true },
      { key: 'username', label: '用户名' },
      { key: 'account_type', label: '用户类型' },
      { key: 'created_at', label: '注册时间' },
    ],
    allColumns: userColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div style={{ padding: 0, marginTop: 12, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {/* 左侧：分群条件（固定模块，占 1/3） */}
      <div
        style={{
          flex: '0 0 33%',
          maxWidth: '33%',
          border: '1px solid var(--semi-color-border)',
          borderRadius: 8,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 160px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flex: '0 0 auto' }}>
          <Text strong style={{ fontSize: 15 }}>分群条件</Text>
          <Space>
            <Button size="small" icon={<IconSearch />} onClick={handlePreview} loading={previewLoading}>
              查询
            </Button>
            <Button size="small" theme="solid" type="primary" onClick={handleSave} loading={saving}>
              保存
            </Button>
          </Space>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>分群名称</label>
                <Input
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  placeholder="如：30天未登录用户"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>描述</label>
                <Input
                  value={form.description}
                  onChange={(v) => setForm({ ...form, description: v })}
                  placeholder="简要说明该分群的用途"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>分群类型</label>
                <Select
                  value={form.is_dynamic}
                  onChange={(v) => setForm({ ...form, is_dynamic: v })}
                  style={{ width: '100%' }}
                >
                  <Select.Option value={true}>动态分群（实时计算）</Select.Option>
                  <Select.Option value={false}>静态分群（固定快照）</Select.Option>
                </Select>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontWeight: 500 }}>分群规则</label>
                <Button size="small" icon={<IconPlus />} onClick={addCondition}>
                  添加条件
                </Button>
              </div>

              {form.rules.conditions.length === 0 ? (
                <Banner type="info" description="请添加至少一个条件来定义用户分群" closeIcon={null} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {form.rules.conditions.map((condition, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        padding: 12,
                        border: '1px solid var(--semi-color-border)',
                        borderRadius: 8,
                        backgroundColor: 'var(--semi-color-fill-0)',
                      }}
                    >
                      {index > 0 && (
                        <Select
                          value={form.rules.logic}
                          onChange={(v) => setForm({ ...form, rules: { ...form.rules, logic: v } })}
                          style={{ width: 80 }}
                        >
                          <Select.Option value="AND">且</Select.Option>
                          <Select.Option value="OR">或</Select.Option>
                        </Select>
                      )}

                      <Select
                        value={condition.field}
                        onChange={(v) => updateCondition(index, 'field', v)}
                        style={{ width: 150 }}
                      >
                        {FIELD_OPTIONS.map((opt) => (
                          <Select.Option key={opt.value} value={opt.value}>
                            {opt.label}
                          </Select.Option>
                        ))}
                      </Select>

                      <Select
                        value={condition.operator}
                        onChange={(v) => updateCondition(index, 'operator', v)}
                        style={{ width: 100 }}
                      >
                        {(OPERATOR_OPTIONS[
                          FIELD_OPTIONS.find((opt) => opt.value === condition.field)?.type
                        ] || []).map((opt) => (
                          <Select.Option key={opt.value} value={opt.value}>
                            {opt.label}
                          </Select.Option>
                        ))}
                      </Select>

                      {renderValueInput(condition, index)}

                      <Button
                        size="small"
                        theme="borderless"
                        type="danger"
                        icon={<IconDelete />}
                        onClick={() => removeCondition(index)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {form.rules.conditions.length > 0 && (
              <Banner
                type="info"
                description={`条件关系：${form.rules.logic === 'AND' ? '所有条件都满足' : '满足任一条件即可'}`}
                closeIcon={null}
              />
            )}

            {previewed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Banner
                    type="success"
                    description={`命中用户：${previewTotal} 人（下方预览前 ${previewUsers.length} 条）`}
                    closeIcon={null}
                    style={{ flex: '1 1 auto' }}
                  />
                  {userColumnConfigButton}
                </div>
                <Spin spinning={previewLoading}>
                  <Table
                    columns={userVisibleColumns}
                    dataSource={previewUsers}
                    rowKey="id"
                    pagination={false}
                    size="small"
                  />
                </Spin>
              </div>
            )}
        </div>
      </div>

      {/* 右侧：已保存分群列表（占 2/3） */}
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 160px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flex: '0 0 auto' }}>
          <Text strong style={{ fontSize: 15, lineHeight: '32px' }}>
            已保存分群
          </Text>
          <Space>
            <Button
              size="small"
              icon={<IconRefresh />}
              onClick={handleRefreshAll}
              loading={refreshingAll}
            >
              刷新人数
            </Button>
            {crowdColumnConfigButton}
          </Space>
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <Table
            columns={crowdVisibleColumns}
            dataSource={crowds}
            loading={loading}
            rowKey="id"
            pagination={{ pageSize: 20 }}
          />
        </div>
      </div>

      {/* 已保存分群 - 查看规则 Modal */}
      <Modal
        title={viewRecord ? `分群规则 · ${viewRecord.name}` : '分群规则'}
        visible={viewVisible}
        onCancel={() => setViewVisible(false)}
        footer={null}
        width={560}
      >
        {viewRecord && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {viewRecord.description && (
              <Text type="tertiary">{viewRecord.description}</Text>
            )}
            {(!viewRecord.parsedRules.conditions || viewRecord.parsedRules.conditions.length === 0) ? (
              <Banner type="info" description="该分群无规则条件" closeIcon={null} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {viewRecord.parsedRules.conditions.map((cond, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {i > 0 && (
                      <Tag color="grey" size="small">
                        {viewRecord.parsedRules.logic === 'OR' ? '或' : '且'}
                      </Tag>
                    )}
                    <div
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        border: '1px solid var(--semi-color-border)',
                        borderRadius: 6,
                        backgroundColor: 'var(--semi-color-fill-0)',
                      }}
                    >
                      {formatCondition(cond)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default UserCrowdConfig;
