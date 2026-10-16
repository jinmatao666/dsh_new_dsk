import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Table, Tag, Space, Input, Select, Modal, Typography, InputNumber, Banner, Spin, DatePicker, Form, TextArea, Upload, Checkbox, Tooltip } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete, IconSearch, IconRefresh } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { renderQuota, renderGroup, renderNumber } from '../../helpers/render';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';
import AdaptiveTable from '../../components/AdaptiveTable';
import BatchGrantModal from '../../components/BatchGrantModal';
import useColumnConfig from '../../hooks/useColumnConfig';

const USER_COLUMN_META = [
  { key: 'username', label: '用户名', always: true },
  { key: 'display_name', label: '显示名称' },
  { key: 'group', label: '分组' },
  { key: 'status', label: '状态' },
  { key: 'account_type', label: '账户类型' },
  { key: 'quota', label: '剩余积分' },
  { key: 'used_quota', label: '已用积分' },
  { key: 'request_count', label: '调用次数' },
  { key: 'tags', label: '标签' },
];

const CROWD_COLUMN_META = [
  { key: 'id', label: 'ID', always: true },
  { key: 'name', label: '分群名称' },
  { key: 'description', label: '描述' },
  { key: 'is_dynamic', label: '类型' },
  { key: 'user_count', label: '用户数量' },
];

const TAG_COLUMN_META = [
  { key: 'name', label: '名称', always: true },
  { key: 'description', label: '描述' },
  { key: 'crowd_ids', label: '人群' },
];

const { Text } = Typography;

// ========== 筛选器常量（复用 UserCrowdConfig）==========
const FIELD_OPTIONS = [
  { value: 'account_type', label: '用户类型', type: 'enum' },
  { value: 'username', label: '用户名', type: 'id_list' },
  { value: 'created_at', label: '注册时间', type: 'datetime' },
  { value: 'last_active_at', label: '最近活跃时间', type: 'datetime' },
  { value: 'purchase_time', label: '购买时间', type: 'datetime' },
  { value: 'purchase_count', label: '购买次数', type: 'number' },
  { value: 'used_quota', label: '已消费积分', type: 'number' },
  { value: 'quota', label: '当前积分余额', type: 'number' },
  { value: 'request_count', label: '请求次数', type: 'number' },
  { value: 'status', label: '账户状态', type: 'enum' },
];

const OPERATOR_OPTIONS = {
  id_list: [
    { value: 'like_any', label: '包含' },
    { value: 'not_like_any', label: '不包含' },
    { value: 'in', label: '包含于' },
    { value: '=', label: '=' },
    { value: '!=', label: '!=' },
  ],
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

// 筛选结果服务端分页每页条数（与后端 preview 接口 page_size 上限一致）。
const PAGE_SIZE = 100;

const UserOperation = () => {
  const [activeTab, setActiveTab] = useState('filter');

  // Tab 1：用户筛选工作台 - 筛选器状态
  // 每个条件携带 connector（与上一个条件之间的连接符，第一个忽略）
  const [filterRules, setFilterRules] = useState({
    conditions: [{ field: 'account_type', operator: '=', value: 1, description: '', connector: 'AND' }],
    logic: 'AND',
  });
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState(null); // { total, users }
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [queryPage, setQueryPage] = useState(1); // 当前服务端页码（从 1 开始）
  const [selectAllMatched, setSelectAllMatched] = useState(false); // 是否"选中全部命中用户"（跨页全量）

  // Tab 2：分群管理 - 列表状态
  const [crowds, setCrowds] = useState([]);
  const [crowdLoading, setCrowdLoading] = useState(false);
  const [refreshingAllCrowds, setRefreshingAllCrowds] = useState(false);
  const [viewRuleVisible, setViewRuleVisible] = useState(false);
  const [viewRuleRecord, setViewRuleRecord] = useState(null);

  // 批量发放弹窗
  const [batchGrantVisible, setBatchGrantVisible] = useState(false);

  // 保存分群弹窗
  const [saveCrowdVisible, setSaveCrowdVisible] = useState(false);
  const [saveCrowdLoading, setSaveCrowdLoading] = useState(false);
  const [crowdForm, setCrowdForm] = useState({ name: '', description: '' });

  // Tab 3：标签管理 - 列表状态
  const [tags, setTags] = useState([]);
  const [tagLoading, setTagLoading] = useState(false);
  // 标签新建/编辑弹窗
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [tagModalLoading, setTagModalLoading] = useState(false);
  const [editingTag, setEditingTag] = useState(null); // null 表示新建
  const [tagForm, setTagForm] = useState({ name: '', description: '', crowd_ids: [] });

  // 批量打标弹窗（作用于筛选结果）：选择标签 -> 给命中/勾选用户追加标签
  const [batchTagVisible, setBatchTagVisible] = useState(false);
  const [batchTagLoading, setBatchTagLoading] = useState(false);
  const [batchTagSelected, setBatchTagSelected] = useState([]); // 选中的标签 id 列表
  const [batchTagUserIds, setBatchTagUserIds] = useState([]); // 本次打标作用的用户 id 列表
  const [batchTagKeyword, setBatchTagKeyword] = useState(''); // 弹窗内标签搜索关键词
  const [batchTagMode, setBatchTagMode] = useState('tag'); // 'tag' 打标 | 'untag' 取消打标

  useEffect(() => {
    if (activeTab === 'crowd') {
      loadCrowds();
    }
    if (activeTab === 'tag') {
      loadTags();
      loadCrowds();
    }
  }, [activeTab]);

  const loadCrowds = useCallback(async () => {
    setCrowdLoading(true);
    try {
      const res = await API.get('/api/user-crowd/');
      if (res.data.success) {
        setCrowds(res.data.data || []);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('获取分群列表失败');
    } finally {
      setCrowdLoading(false);
    }
  }, []);

  const handleRefreshAllCrowds = async () => {
    setRefreshingAllCrowds(true);
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
    } finally {
      setRefreshingAllCrowds(false);
    }
  };

  const loadTags = useCallback(async () => {
    setTagLoading(true);
    try {
      const res = await API.get('/api/user-tag/');
      if (res.data.success) {
        setTags(res.data.data || []);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('获取标签列表失败');
    } finally {
      setTagLoading(false);
    }
  }, []);

  // ========== 筛选器逻辑 ==========
  const addCondition = () => {
    setFilterRules({
      ...filterRules,
      conditions: [
        ...filterRules.conditions,
        { field: 'account_type', operator: '=', value: '', description: '', connector: 'AND' },
      ],
    });
  };

  const removeCondition = (index) => {
    const newConditions = [...filterRules.conditions];
    newConditions.splice(index, 1);
    setFilterRules({ ...filterRules, conditions: newConditions });
  };

  const updateCondition = (index, field, value) => {
    const newConditions = [...filterRules.conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };

    if (field === 'field') {
      const fieldConfig = FIELD_OPTIONS.find((opt) => opt.value === value);
      const operators = OPERATOR_OPTIONS[fieldConfig?.type] || [];
      newConditions[index].operator = operators[0]?.value || '=';
      newConditions[index].value = '';
    }

    // between 与其它操作符的值结构不同（区间 vs 单值），切换时重置避免脏值
    if (field === 'operator') {
      const prevOp = filterRules.conditions[index]?.operator;
      if ((prevOp === 'between') !== (value === 'between')) {
        newConditions[index].value = '';
        newConditions[index].customMode = false;
      }
    }

    setFilterRules({ ...filterRules, conditions: newConditions });
  };

  const renderValueInput = (condition, index) => {
    const fieldConfig = FIELD_OPTIONS.find((opt) => opt.value === condition.field);
    const fieldType = fieldConfig?.type;

    // id_list：文本框批量输入 + 文件上传
    if (fieldType === 'id_list') {
      // value 原样存用户输入的文本，查询时再规范化为逗号列表
      const rawText = typeof condition.value === 'string' ? condition.value : '';

      const handleTextChange = (v) => {
        updateCondition(index, 'value', v);
      };

      const parseTextToNames = (text) =>
        text.split(/[,，;；\n]+/).map((s) => s.trim()).filter(Boolean);

      const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        const ext = file.name.split('.').pop().toLowerCase();
        try {
          if (ext === 'xlsx' || ext === 'xls') {
            const XLSX = (await import('xlsx')).default;
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
            const names = rows.flat().map((v) => String(v ?? '').trim()).filter(Boolean);
            updateCondition(index, 'value', names.join('\n'));
          } else {
            const text = await file.text();
            let names;
            if (ext === 'json') {
              try {
                const parsed = JSON.parse(text);
                const flat = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
                names = flat.map((v) => String(v ?? '').trim()).filter(Boolean);
              } catch {
                names = parseTextToNames(text);
              }
            } else {
              names = parseTextToNames(text);
            }
            updateCondition(index, 'value', names.join('\n'));
          }
        } catch (err) {
          console.error('文件解析失败', err);
        }
      };

      const nameCount = parseTextToNames(rawText).length;
      const fileInputRef = React.createRef();

      return (
        <div style={{ flexBasis: '100%', width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <TextArea
            value={rawText}
            onChange={handleTextChange}
            rows={4}
            placeholder={'每行一个用户名，或逗号/空格/分号分隔\n例：alice\nbob, charlie'}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="tertiary" style={{ fontSize: 12 }}>
              {nameCount > 0 ? `已输入 ${nameCount} 个用户名` : ''}
            </Text>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.md,.json,.xlsx,.xls,.docx,.doc"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <Button size="small" theme="borderless" onClick={() => fileInputRef.current?.click()}>
              从文件导入
            </Button>
          </div>
        </div>
      );
    }

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
            style={{ flexBasis: '100%', width: '100%' }}
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
          const newConditions = [...filterRules.conditions];
          newConditions[index] = { ...newConditions[index], value: v, customMode: false };
          setFilterRules({ ...filterRules, conditions: newConditions });
        }
      };
      return (
        <>
          <Select
            value={isCustomMode ? '__custom__' : condition.value}
            onChange={onModeChange}
            style={{ flex: '1 1 130px', minWidth: 130 }}
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
              style={{ flexBasis: '100%', width: '100%' }}
              placeholder="选择日期时间"
            />
          )}
        </>
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

  // 将筛选条件规范化后序列化为后端规则 JSON（统一打标/查询用同一份规则）。
  const buildNormalizedRules = () => {
    const normalizedConditions = filterRules.conditions.map((cond) => {
      const fieldConfig = FIELD_OPTIONS.find((opt) => opt.value === cond.field);
      if (fieldConfig?.type === 'id_list' && typeof cond.value === 'string') {
        const names = cond.value.split(/[,，;；\n]+/).map((s) => s.trim()).filter(Boolean);
        return { ...cond, value: names.join(',') };
      }
      return cond;
    });
    return JSON.stringify({ ...filterRules, conditions: normalizedConditions });
  };

  // 服务端分页查询：page 从 1 开始，每页 100（后端 page_size 上限）。
  const handleQuery = async (page = 1) => {
    if (!filterRules.conditions || filterRules.conditions.length === 0) {
      showError('请至少添加一个条件');
      return;
    }
    setQueryLoading(true);
    // 切换筛选条件/重新查询时清空勾选与"全选全量"；翻页同样清空勾选避免跨页歧义。
    setSelectedUsers([]);
    setSelectAllMatched(false);
    try {
      const res = await API.post('/api/user-crowd/preview', {
        rules: buildNormalizedRules(),
        page,
        page_size: PAGE_SIZE,
      });
      if (res.data.success) {
        setQueryResult({
          total: res.data.total || 0,
          users: res.data.data || [],
        });
        setQueryPage(page);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('查询失败');
    } finally {
      setQueryLoading(false);
    }
  };

  // ========== 工具栏占位 ==========
  const handleCreateCrowd = () => {
    if (!queryResult || queryResult.total === 0) {
      showError('请先执行查询并确认命中用户');
      return;
    }
    if (!filterRules.conditions || filterRules.conditions.length === 0) {
      showError('请至少添加一个筛选条件');
      return;
    }
    setCrowdForm({ name: '', description: '' });
    setSaveCrowdVisible(true);
  };

  const handleSaveCrowd = async () => {
    if (!crowdForm.name || !crowdForm.name.trim()) {
      showError('请输入分群名称');
      return;
    }

    setSaveCrowdLoading(true);
    try {
      const res = await API.post('/api/user-crowd/', {
        name: crowdForm.name.trim(),
        description: crowdForm.description?.trim() || '',
        rules: JSON.stringify(filterRules),
        is_dynamic: true,
      });

      if (res.data.success) {
        showSuccess('分群保存成功');
        setSaveCrowdVisible(false);
        setCrowdForm({ name: '', description: '' });
        // 如果当前在分群管理 Tab，刷新列表
        if (activeTab === 'crowd') {
          loadCrowds();
        }
      } else {
        showError(res.data.message || '保存失败');
      }
    } catch (error) {
      console.error('保存分群失败:', error);
      showError(error.response?.data?.message || error.message || '保存分群失败');
    } finally {
      setSaveCrowdLoading(false);
    }
  };

  const handleBatchTag = (mode = 'tag') => {
    if (!queryResult || queryResult.total === 0) {
      showError('当前没有命中用户');
      return;
    }
    // 选中"全部命中"时走 rules（全量）；否则用勾选的用户；都没有则默认作用于全部命中。
    const ids = selectAllMatched ? [] : selectedUsers.map((u) => u.id);
    setBatchTagMode(mode);
    setBatchTagUserIds(ids);
    setBatchTagSelected([]);
    setBatchTagKeyword('');
    // 确保标签列表已加载（用于弹窗多选）。
    if (tags.length === 0) {
      loadTags();
    }
    setBatchTagVisible(true);
  };

  const handleSaveBatchTag = async () => {
    if (batchTagSelected.length === 0) {
      showError('请至少选择一个标签');
      return;
    }
    const isUntag = batchTagMode === 'untag';
    setBatchTagLoading(true);
    try {
      // 勾选了用户用 user_ids；否则传 rules 让服务端解析全部命中用户（避免前端只拿到首页）。
      const payload = { tag_ids: batchTagSelected };
      if (batchTagUserIds.length > 0) {
        payload.user_ids = batchTagUserIds;
      } else {
        payload.rules = buildNormalizedRules();
      }
      const url = isUntag ? '/api/user-tag/batch-untag' : '/api/user-tag/batch';
      const res = await API.post(url, payload);
      if (res.data.success) {
        const count = res.data.data?.user_count ?? 0;
        showSuccess(isUntag ? `已为 ${count} 名用户取消标签` : `已为 ${count} 名用户打标`);
        setBatchTagVisible(false);
        setBatchTagSelected([]);
        // 刷新筛选结果（保持当前页），展示最新标签列。
        handleQuery(queryPage);
      } else {
        showError(res.data.message || (isUntag ? '取消打标失败' : '打标失败'));
      }
    } catch (error) {
      console.error(isUntag ? '批量取消打标失败:' : '批量打标失败:', error);
      showError(error.response?.data?.message || error.message || (isUntag ? '批量取消打标失败' : '批量打标失败'));
    } finally {
      setBatchTagLoading(false);
    }
  };

  const handleBatchGrant = () => {
    if (!queryResult || queryResult.total === 0) {
      showError('当前没有命中用户');
      return;
    }
    setBatchGrantVisible(true);
  };

  const handleDeleteCrowd = (record) => {
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
        }
      },
    });
  };

  const handleViewRule = (record) => {
    const parsed = typeof record.rules === 'string' ? JSON.parse(record.rules) : record.rules;
    setViewRuleRecord({ ...record, parsedRules: parsed || { conditions: [], logic: 'AND' } });
    setViewRuleVisible(true);
  };

  // ========== 标签管理逻辑 ==========
  const parseTagCrowdIds = (record) => {
    if (Array.isArray(record.crowd_ids)) return record.crowd_ids;
    if (!record.crowd_ids) return [];
    try {
      const parsed = JSON.parse(record.crowd_ids);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  const openCreateTag = () => {
    setEditingTag(null);
    setTagForm({ name: '', description: '', crowd_ids: [] });
    setTagModalVisible(true);
  };

  const openEditTag = (record) => {
    setEditingTag(record);
    setTagForm({
      name: record.name || '',
      description: record.description || '',
      crowd_ids: parseTagCrowdIds(record),
    });
    setTagModalVisible(true);
  };

  const handleSaveTag = async () => {
    if (!tagForm.name || !tagForm.name.trim()) {
      showError('请输入标签名称');
      return;
    }
    setTagModalLoading(true);
    try {
      const payload = {
        name: tagForm.name.trim(),
        description: tagForm.description?.trim() || '',
        crowd_ids: JSON.stringify(tagForm.crowd_ids || []),
      };
      let res;
      if (editingTag) {
        res = await API.put('/api/user-tag/', { ...payload, id: editingTag.id });
      } else {
        res = await API.post('/api/user-tag/', payload);
      }
      if (res.data.success) {
        showSuccess(editingTag ? '标签更新成功' : '标签创建成功');
        setTagModalVisible(false);
        loadTags();
      } else {
        showError(res.data.message || '保存失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '保存标签失败');
    } finally {
      setTagModalLoading(false);
    }
  };

  const handleDeleteTag = (record) => {
    Modal.confirm({
      title: '删除标签',
      content: `确定删除标签「${record.name}」？此操作不可恢复。`,
      type: 'warning',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await API.delete(`/api/user-tag/${record.id}`);
          if (res.data.success) {
            showSuccess('删除成功');
            loadTags();
          } else {
            showError(res.data.message);
          }
        } catch (error) {
          showError('删除失败');
        }
      },
    });
  };

  const crowdNameById = (id) => crowds.find((c) => c.id === id)?.name || `#${id}`;

  const formatCondition = (cond) => {
    const fieldLabel = FIELD_OPTIONS.find((f) => f.value === cond.field)?.label || cond.field;
    const fieldType = FIELD_OPTIONS.find((f) => f.value === cond.field)?.type;
    const opLabel = (OPERATOR_OPTIONS[fieldType] || []).find((o) => o.value === cond.operator)?.label || cond.operator;

    if (fieldType === 'id_list') {
      const ids = typeof cond.value === 'string' ? cond.value.split(',').filter(Boolean) : [];
      return `${fieldLabel} 包含 ${ids.length} 个用户名`;
    }

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

  // ========== Columns ==========
  const userColumns = [
    { title: '用户名', dataIndex: 'username', width: 150 },
    { title: '显示名称', dataIndex: 'display_name', width: 150, render: (text) => text || '-' },
    { title: '分组', dataIndex: 'group', width: 120, render: (text) => renderGroup(text || 'default') },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => {
        if (v === 1) return <Tag color="green">正常</Tag>;
        if (v === 2) return <Tag color="red">已禁用</Tag>;
        return <Tag color="grey">未知</Tag>;
      },
    },
    {
      title: '账户类型',
      dataIndex: 'account_type',
      width: 100,
      render: (v) => (v === 2 ? <Tag color="violet">企业</Tag> : <Tag color="grey">个体</Tag>),
    },
    { title: '剩余积分', dataIndex: 'quota', width: 120, render: (quota) => renderQuota(quota || 0) },
    { title: '已用积分', dataIndex: 'used_quota', width: 120, render: (quota) => renderQuota(quota || 0) },
    { title: '调用次数', dataIndex: 'request_count', width: 120, render: (count) => renderNumber(count || 0) },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 200,
      render: (tags) => {
        if (!tags || tags.length === 0) return <Text type="tertiary">-</Text>;
        return (
          <Space wrap spacing={4}>
            {tags.map((t) => (
              <Tag key={t.id} color="blue">{t.name}</Tag>
            ))}
          </Space>
        );
      },
    },
  ];

  const crowdColumns = [
    { title: 'ID', dataIndex: 'id' },
    { title: '分群名称', dataIndex: 'name' },
    { title: '描述', dataIndex: 'description', render: (v) => v || '-' },
    {
      title: '类型',
      dataIndex: 'is_dynamic',
      render: (v) => <Tag color={v ? 'blue' : 'grey'}>{v ? '动态' : '静态'}</Tag>,
    },
    {
      title: '用户数量',
      dataIndex: 'user_count',
      render: (v) => <Text>{v || 0} 人</Text>,
    },
    {
      title: '操作',
      render: (text, record) => (
        <Space>
          <Button size="small" theme="borderless" onClick={() => handleViewRule(record)}>
            查看规则
          </Button>
          <Button size="small" theme="borderless" type="danger" onClick={() => handleDeleteCrowd(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const tagColumns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (v) => v || '-' },
    {
      title: '人群',
      dataIndex: 'crowd_ids',
      render: (_, record) => {
        const ids = parseTagCrowdIds(record);
        if (ids.length === 0) return <Text type="tertiary">-</Text>;
        return (
          <Space wrap spacing={4}>
            {ids.map((id) => (
              <Tag key={id} color="blue">{crowdNameById(id)}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '操作',
      width: 150,
      render: (text, record) => (
        <Space>
          <Button size="small" theme="borderless" onClick={() => openEditTag(record)}>
            编辑
          </Button>
          <Button size="small" theme="borderless" type="danger" onClick={() => handleDeleteTag(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const { visibleColumns: userVisibleColumns, columnConfigButton: userColumnConfigButton } = useColumnConfig({
    storageKey: 'useroperation_user_table_visible_columns',
    columnMeta: USER_COLUMN_META,
    allColumns: userColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: crowdVisibleColumns, columnConfigButton: crowdColumnConfigButton } = useColumnConfig({
    storageKey: 'useroperation_crowd_table_visible_columns',
    columnMeta: CROWD_COLUMN_META,
    allColumns: crowdColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: tagVisibleColumns, columnConfigButton: tagColumnConfigButton } = useColumnConfig({
    storageKey: 'useroperation_tag_table_visible_columns',
    columnMeta: TAG_COLUMN_META,
    allColumns: tagColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div style={{ height: '100%' }}>
      <ConfigPageTabs activeKey={activeTab} onChange={setActiveTab}>
        {/* Tab 1: 用户筛选工作台 */}
        <ConfigPageTabPane tab="用户筛选" itemKey="filter">
          <div style={{ padding: 0, marginTop: 12, display: 'flex', gap: 16, alignItems: 'flex-start', height: 'calc(100vh - 156px)' }}>
            {/* 左侧：条件筛选 */}
            <div
              style={{
                flex: '0 0 33%',
                maxWidth: '33%',
                border: '1px solid var(--semi-color-border)',
                borderRadius: 8,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flex: '0 0 auto' }}>
                <Text strong style={{ fontSize: 15 }}>条件筛选</Text>
                <Button size="small" icon={<IconSearch />} onClick={() => handleQuery(1)} loading={queryLoading}>
                  查询
                </Button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontWeight: 500 }}>筛选规则</label>
                    <Button size="small" icon={<IconPlus />} onClick={addCondition}>
                      添加条件
                    </Button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {filterRules.conditions.map((condition, index) => (
                        <React.Fragment key={index}>
                          {index > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <Select
                                value={condition.connector || 'AND'}
                                onChange={(v) => updateCondition(index, 'connector', v)}
                                style={{ width: 80 }}
                                size="small"
                              >
                                <Select.Option value="AND">且</Select.Option>
                                <Select.Option value="OR">或</Select.Option>
                              </Select>
                            </div>
                          )}
                          <div
                            style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
                          >
                            <div
                              style={{
                                flex: '1 1 0',
                                minWidth: 0,
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                padding: 12,
                                border: '1px solid var(--semi-color-border)',
                                borderRadius: 8,
                                backgroundColor: 'var(--semi-color-fill-0)',
                              }}
                            >
                              <Select
                                value={condition.field}
                                onChange={(v) => updateCondition(index, 'field', v)}
                                style={{ flex: '1 1 110px', minWidth: 90 }}
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
                                style={{ flex: '0 1 90px', minWidth: 72 }}
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
                            </div>

                            <Button
                              size="small"
                              theme="borderless"
                              type="danger"
                              icon={<IconDelete />}
                              onClick={() => removeCondition(index)}
                              style={{ flexShrink: 0, marginTop: 8 }}
                            />
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
              </div>
            </div>

            {/* 右侧：结果区（工具栏与分页常驻，未查询时表体显示空提示） */}
            <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* 顶部工具栏 */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, flex: '0 0 auto' }}>
                <Space align="center">
                  <Button onClick={handleCreateCrowd}>保存为分群</Button>
                  <Button onClick={() => handleBatchTag('tag')}>批量打标</Button>
                  <Button onClick={() => handleBatchTag('untag')}>批量取消标签</Button>
                  <Button onClick={handleBatchGrant}>批量发放</Button>
                  <Text type="tertiary">命中用户 <Text strong>{queryResult ? queryResult.total : 0}</Text></Text>
                  <Text type="tertiary">
                    已选择{' '}
                    <Text strong>{selectAllMatched ? (queryResult ? queryResult.total : 0) : selectedUsers.length}</Text>
                    {selectAllMatched ? '（全部命中）' : ''}
                  </Text>
                  {userColumnConfigButton}
                </Space>
              </div>

              {/* 全选全量提示条：勾选当前页全选后，提示可一键选中全部命中用户（跨页全量） */}
              {queryResult && queryResult.total > queryResult.users.length && (selectedUsers.length > 0 || selectAllMatched) && (
                <Banner
                  type="info"
                  closeIcon={null}
                  style={{ marginBottom: 12 }}
                  description={
                    selectAllMatched ? (
                      <span>
                        已选中全部 <Text strong>{queryResult.total}</Text> 名命中用户。
                        <Button theme="borderless" size="small" onClick={() => { setSelectAllMatched(false); setSelectedUsers([]); }}>
                          取消全选
                        </Button>
                      </span>
                    ) : (
                      <span>
                        已选中当前页 <Text strong>{selectedUsers.length}</Text> 人。
                        <Button theme="borderless" size="small" onClick={() => setSelectAllMatched(true)}>
                          选中全部命中的 {queryResult.total} 名用户
                        </Button>
                      </span>
                    )
                  }
                />
              )}

              {/* 用户表格：服务端分页（每页 PAGE_SIZE 条），分页器固定在底部 */}
              <div style={{ flex: '1 1 auto', minHeight: 0 }}>
                <Spin spinning={queryLoading}>
                  <Table
                    columns={userVisibleColumns}
                    dataSource={queryResult ? queryResult.users : []}
                    rowKey="id"
                    pagination={{
                      currentPage: queryPage,
                      pageSize: PAGE_SIZE,
                      total: queryResult ? queryResult.total : 0,
                      onPageChange: (page) => handleQuery(page),
                    }}
                    scroll={{ y: 'calc(100vh - 290px)' }}
                    empty={<Text type="tertiary">左侧条件筛选查询后显示命中用户</Text>}
                    rowSelection={{
                      selectedRowKeys: selectAllMatched
                        ? (queryResult ? queryResult.users.map((u) => u.id) : [])
                        : selectedUsers.map((u) => u.id),
                      onChange: (keys, rows) => {
                        // 手动改动勾选即退出"全选全量"状态，回到当前页勾选语义。
                        setSelectAllMatched(false);
                        setSelectedUsers(rows);
                      },
                    }}
                  />
                </Spin>
              </div>
            </div>
          </div>
        </ConfigPageTabPane>

        {/* Tab 2: 分群管理（仅列表） */}
        <ConfigPageTabPane tab="分群管理" itemKey="crowd">
          <div style={{ paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Button
                icon={<IconRefresh />}
                onClick={handleRefreshAllCrowds}
                loading={refreshingAllCrowds}
              >
                刷新人数
              </Button>
              {crowdColumnConfigButton}
            </div>
            <AdaptiveTable
              columns={crowdVisibleColumns}
              dataSource={crowds}
              loading={crowdLoading}
              rowKey="id"
              pagination={{ pageSize: 20 }}
            />
          </div>
        </ConfigPageTabPane>

        {/* Tab 3: 标签管理 */}
        <ConfigPageTabPane tab="标签管理" itemKey="tag">
          <div style={{ paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Button icon={<IconPlus />} onClick={openCreateTag}>
                新建标签
              </Button>
              {tagColumnConfigButton}
            </div>
            <AdaptiveTable
              columns={tagVisibleColumns}
              dataSource={tags}
              loading={tagLoading}
              rowKey="id"
              pagination={{ pageSize: 20 }}
            />
          </div>
        </ConfigPageTabPane>
      </ConfigPageTabs>

      {/* 保存分群弹窗 */}
      <Modal
        title="保存为分群"
        visible={saveCrowdVisible}
        onCancel={() => setSaveCrowdVisible(false)}
        onOk={handleSaveCrowd}
        confirmLoading={saveCrowdLoading}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form labelPosition="top">
          <Form.Input
            field="name"
            label={{ text: <span><span style={{ color: '#FF3B30', marginRight: 2 }}>*</span>分群名称</span>, required: false }}
            placeholder="请输入分群名称"
            value={crowdForm.name}
            onChange={(value) => setCrowdForm({ ...crowdForm, name: value })}
            rules={[{ required: true, message: '分群名称必填' }]}
            style={{ width: '100%' }}
          />
          <Form.TextArea
            field="description"
            label="分群说明"
            placeholder="请输入分群说明（可选）"
            value={crowdForm.description}
            onChange={(value) => setCrowdForm({ ...crowdForm, description: value })}
            rows={3}
            style={{ width: '100%' }}
          />
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>筛选条件预览</Text>
            <div style={{
              padding: 12,
              background: 'var(--semi-color-fill-0)',
              borderRadius: 6,
              border: '1px solid var(--semi-color-border)'
            }}>
              {filterRules.conditions.length === 0 ? (
                <Text type="tertiary">暂无筛选条件</Text>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filterRules.conditions.map((cond, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      {i > 0 && (
                        <Tag size="small" color="grey">
                          {(cond.connector || filterRules.logic) === 'OR' ? '或' : '且'}
                        </Tag>
                      )}
                      <Text>{formatCondition(cond)}</Text>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {queryResult && (
            <div style={{ marginTop: 12 }}>
              <Text type="tertiary" style={{ fontSize: 13 }}>
                当前命中用户：<Text strong>{queryResult.total}</Text> 人
              </Text>
            </div>
          )}
        </Form>
      </Modal>

      {/* 查看分群规则 Modal */}
      <Modal
        title={viewRuleRecord ? `分群规则 · ${viewRuleRecord.name}` : '分群规则'}
        visible={viewRuleVisible}
        onCancel={() => setViewRuleVisible(false)}
        footer={null}
        width={560}
      >
        {viewRuleRecord && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {viewRuleRecord.description && (
              <Text type="tertiary">{viewRuleRecord.description}</Text>
            )}
            {(!viewRuleRecord.parsedRules.conditions || viewRuleRecord.parsedRules.conditions.length === 0) ? (
              <Banner type="info" description="该分群无规则条件" closeIcon={null} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {viewRuleRecord.parsedRules.conditions.map((cond, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {i > 0 && (
                      <Tag color="grey" size="small">
                        {(cond.connector || viewRuleRecord.parsedRules.logic) === 'OR' ? '或' : '且'}
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

      {/* 新建/编辑标签弹窗 */}      <Modal
        title={editingTag ? '编辑标签' : '新建标签'}
        visible={tagModalVisible}
        onCancel={() => setTagModalVisible(false)}
        onOk={handleSaveTag}
        confirmLoading={tagModalLoading}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form labelPosition="top">
          <Form.Input
            field="name"
            label={{ text: <span><span style={{ color: '#FF3B30', marginRight: 2 }}>*</span>标签名称</span>, required: false }}
            placeholder="请输入标签名称"
            value={tagForm.name}
            onChange={(value) => setTagForm({ ...tagForm, name: value })}
            rules={[{ required: true, message: '标签名称必填' }]}
            style={{ width: '100%' }}
          />
          <Form.TextArea
            field="description"
            label="描述"
            placeholder="请输入标签描述（可选）"
            value={tagForm.description}
            onChange={(value) => setTagForm({ ...tagForm, description: value })}
            rows={3}
            style={{ width: '100%' }}
          />
          <Form.Select
            field="crowd_ids"
            label="匹配人群"
            placeholder="选择关联人群（可选，可多选）"
            multiple
            filter
            value={tagForm.crowd_ids}
            onChange={(value) => setTagForm({ ...tagForm, crowd_ids: value || [] })}
            style={{ width: '100%' }}
          >
            {crowds.map((crowd) => (
              <Form.Select.Option key={crowd.id} value={crowd.id}>
                {crowd.name}
              </Form.Select.Option>
            ))}
          </Form.Select>
        </Form>
      </Modal>

      {/* 批量发放弹窗 */}
      <BatchGrantModal
        visible={batchGrantVisible}
        onCancel={() => setBatchGrantVisible(false)}
        onSuccess={() => setBatchGrantVisible(false)}
        rules={JSON.stringify({
          ...filterRules,
          conditions: filterRules.conditions.map((cond) => {
            const fieldConfig = FIELD_OPTIONS.find((opt) => opt.value === cond.field);
            if (fieldConfig?.type === 'id_list' && typeof cond.value === 'string') {
              const names = cond.value.split(/[,，;；\n]+/).map((s) => s.trim()).filter(Boolean);
              return { ...cond, value: names.join(',') };
            }
            return cond;
          }),
        })}
        totalUsers={queryResult ? queryResult.total : 0}
      />

      {/* 批量打标/取消标签弹窗 */}
      <Modal
        title={batchTagMode === 'untag' ? '批量取消标签' : '批量打标'}
        visible={batchTagVisible}
        onCancel={() => setBatchTagVisible(false)}
        onOk={handleSaveBatchTag}
        confirmLoading={batchTagLoading}
        okText={batchTagMode === 'untag' ? '确定取消' : '确定打标'}
        okButtonProps={batchTagMode === 'untag' ? { type: 'danger' } : undefined}
        cancelText="取消"
        width={640}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="tertiary">
            将作用于{' '}
            <Text strong>
              {batchTagUserIds.length > 0 ? batchTagUserIds.length : (queryResult ? queryResult.total : 0)}
            </Text>{' '}
            名用户（{batchTagUserIds.length > 0 ? '已勾选' : '全部命中'}），{batchTagMode === 'untag' ? '移除所选标签。' : '追加所选标签。'}
          </Text>
        </div>
        {batchTagSelected.length > 0 ? (
          <div
            style={{
              marginBottom: 12,
              padding: '8px 12px',
              background: 'var(--semi-color-fill-0)',
              borderRadius: 8,
            }}
          >
            <div style={{ marginBottom: 6 }}>
              <Text type="tertiary">已选 {batchTagSelected.length} 个标签</Text>
            </div>
            <Space wrap spacing={4}>
              {batchTagSelected.map((id) => {
                const tag = tags.find((t) => t.id === id);
                if (!tag) return null;
                return (
                  <Tag
                    key={id}
                    color="blue"
                    closable
                    onClose={() => setBatchTagSelected((prev) => prev.filter((x) => x !== id))}
                  >
                    {tag.name}
                  </Tag>
                );
              })}
            </Space>
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <Text type="tertiary">已选 0 个标签</Text>
          </div>
        )}
        <Input
          prefix={<IconSearch />}
          placeholder="搜索标签名称或描述"
          value={batchTagKeyword}
          onChange={(v) => setBatchTagKeyword(v)}
          showClear
          style={{ marginBottom: 12 }}
        />
        {(() => {
          const kw = batchTagKeyword.trim().toLowerCase();
          const filtered = kw
            ? tags.filter(
                (t) =>
                  (t.name || '').toLowerCase().includes(kw) ||
                  (t.description || '').toLowerCase().includes(kw),
              )
            : tags;

          if (tags.length === 0) {
            return <Text type="tertiary">暂无可用标签，请先在「标签管理」中创建标签。</Text>;
          }
          if (filtered.length === 0) {
            return <Text type="tertiary">没有匹配「{batchTagKeyword}」的标签</Text>;
          }

          const toggle = (id) => {
            setBatchTagSelected((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            );
          };

          return (
            <div
              style={{
                maxHeight: 420,
                overflowY: 'auto',
                border: '1px solid var(--semi-color-border)',
                borderRadius: 8,
              }}
            >
              {filtered.map((t, idx) => {
                const checked = batchTagSelected.includes(t.id);
                return (
                  <div
                    key={t.id}
                    onClick={() => toggle(t.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 12px',
                      cursor: 'pointer',
                      borderTop: idx === 0 ? 'none' : '1px solid var(--semi-color-fill-0)',
                      background: checked ? 'var(--semi-color-primary-light-default)' : 'transparent',
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      style={{ pointerEvents: 'none' }}
                    />
                    <div style={{ width: 160, flexShrink: 0, fontWeight: 500 }}>{t.name}</div>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        color: 'var(--semi-color-text-2)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {t.description || '-'}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};

export default UserOperation;
