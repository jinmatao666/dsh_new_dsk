import React, { useEffect, useState, useCallback } from 'react';
import { Button, Table, Tag, Space, Input, Modal, Typography, Banner, Form, TextArea, Select, AutoComplete, Spin } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSetting } from '@douyinfe/semi-icons';
import { ConfigPageTabs, ConfigPageTabPane } from '../../components/ConfigPageLayout';
import useColumnConfig from '../../hooks/useColumnConfig';
import { API, copy, showError, showSuccess, timestamp2string } from '../../helpers';

const { Text, Title } = Typography;

const STATUS_ENABLED = 1;
const STATUS_DISABLED = 2;

// 状态渲染
const renderStatus = (status) =>
  status === STATUS_ENABLED ? (
    <Tag color="green">启用</Tag>
  ) : (
    <Tag color="grey">停用</Tag>
  );

// 分（cents）→ ¥xx.xx 展示
const fmtYuan = (cents) => `¥${((cents || 0) / 100).toFixed(2)}`;

// 奖励规则结构化预览（只读渲染 tiers / unit_price / modifiers）
function RulestructPreview({ rule }) {
  if (!rule || !rule.mode) {
    return <Text type="tertiary">暂无规则</Text>;
  }
  return (
    <div style={{ fontSize: 13 }}>
      {rule.note && (
        <div style={{ marginBottom: 8 }}>
          <Text strong>说明：</Text>
          <Text>{rule.note}</Text>
        </div>
      )}
      {rule.mode === 'per_unit' && (
        <Text>单价模式：每个有效用户 ¥{rule.unit_price}</Text>
      )}
      {(rule.mode === 'tiered' || rule.mode === 'tiered_per_unit') && (
        <div>
          <Text strong>阶梯：</Text>
          {(rule.tiers || []).map((t, i) => (
            <div key={i} style={{ paddingLeft: 12 }}>
              {t.min_count} ~ {t.max_count === 0 ? '∞' : t.max_count} 人：每人 ¥{t.unit_price}
              {t.flat_bonus ? ` + 固定 ¥${t.flat_bonus}` : ''}
            </div>
          ))}
        </div>
      )}
      {(rule.modifiers || []).length > 0 && (
        <div style={{ marginTop: 6 }}>
          <Text strong>系数：</Text>
          {(rule.modifiers || []).map((m, i) => (
            <div key={i} style={{ paddingLeft: 12 }}>
              {m.field === 'channel' ? '渠道' : '达人名'} = {m.equals} → ×{m.multiplier}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InfluencerCode() {
  const [tab, setTab] = useState('codes');

  // ========== 兑换码管理 ==========
  const [codes, setCodes] = useState([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterChannel, setFilterChannel] = useState('');

  // 新建弹窗
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({ phone: '', influencer_name: '', channel: '' });

  // 批量导入弹窗
  const [importVisible, setImportVisible] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importContent, setImportContent] = useState('');
  const [importResults, setImportResults] = useState(null);

  // 多选
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);

  // 已有渠道（供新建/改渠道时选择，独立于列表筛选）
  const [channelOptions, setChannelOptions] = useState([]);

  // 批量改渠道弹窗
  const [channelVisible, setChannelVisible] = useState(false);
  const [channelValue, setChannelValue] = useState('');

  // 设置弹窗（有效人群 + 奖励规则）
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [crowds, setCrowds] = useState([]);
  const [settingsCrowdId, setSettingsCrowdId] = useState(0);
  const [ruleDesc, setRuleDesc] = useState('');
  const [generating, setGenerating] = useState(false);
  const [previewRule, setPreviewRule] = useState(null);

  // 结算
  const [settleLoading, setSettleLoading] = useState(false);
  const [settleVisible, setSettleVisible] = useState(false);
  const [settlePassword, setSettlePassword] = useState('');
  const [settleSummary, setSettleSummary] = useState({ isPartial: false, count: 0, totalValid: 0, totalCents: 0 });

  // 结算历史弹窗（单码）
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyCode, setHistoryCode] = useState(null);

  // ========== 奖励记录 ==========
  const [settlements, setSettlements] = useState([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [itemsVisible, setItemsVisible] = useState(false);
  const [itemsRows, setItemsRows] = useState([]);
  const [itemsBatch, setItemsBatch] = useState(null);

  // 当期规则快照弹窗
  const [ruleSnapshotVisible, setRuleSnapshotVisible] = useState(false);
  const [ruleSnapshotData, setRuleSnapshotData] = useState(null);
  const [ruleSnapshotBatch, setRuleSnapshotBatch] = useState(null);

  const loadChannels = useCallback(async () => {
    try {
      const res = await API.get('/api/influencer-code/?page=1&page_size=100');
      if (res.data.success) {
        const set = new Set();
        (res.data.data || []).forEach((c) => {
          const ch = (c.channel || '').trim();
          if (ch) set.add(ch);
        });
        setChannelOptions(Array.from(set));
      }
    } catch (error) {
      // 渠道候选加载失败不阻塞主流程
    }
  }, []);

  const loadCodes = useCallback(async () => {
    setCodesLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', page_size: '100' });
      if (filterName) params.append('influencer_name', filterName);
      if (filterChannel) params.append('channel', filterChannel);
      const res = await API.get(`/api/influencer-code/with-reward?${params.toString()}`);
      if (res.data.success) {
        setCodes(res.data.data || []);
      } else {
        showError(res.data.message || '加载兑换码失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '加载兑换码失败');
    } finally {
      setCodesLoading(false);
    }
  }, [filterName, filterChannel]);

  useEffect(() => {
    loadCodes();
  }, [loadCodes]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const handleCopyCode = async (code) => {
    if (await copy(code)) {
      showSuccess('已复制兑换码');
    } else {
      Modal.info({ title: '兑换码', content: code });
    }
  };

  const handleCreate = async () => {
    const phone = (createForm.phone || '').trim();
    if (!phone) {
      showError('请输入达人手机号');
      return;
    }
    const channel = (createForm.channel || '').trim();
    if (!channel) {
      showError('请输入投放渠道');
      return;
    }
    setCreateLoading(true);
    try {
      const res = await API.post('/api/influencer-code/', {
        phone,
        influencer_name: (createForm.influencer_name || '').trim(),
        channel,
      });
      if (res.data.success) {
        showSuccess('创建成功');
        setCreateVisible(false);
        setCreateForm({ phone: '', influencer_name: '', channel: '' });
        loadCodes();
        loadChannels();
      } else {
        showError(res.data.message || '创建失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '创建失败');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleToggleStatus = async (record) => {
    const next = record.status === STATUS_ENABLED ? STATUS_DISABLED : STATUS_ENABLED;
    try {
      const res = await API.put(`/api/influencer-code/${record.id}`, {
        status: next,
        influencer_name: record.influencer_name,
        channel: record.channel,
        remark: record.remark,
      });
      if (res.data.success) {
        showSuccess('已更新状态');
        loadCodes();
      } else {
        showError(res.data.message || '更新失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '更新失败');
    }
  };

  const handleDelete = (record) => {
    Modal.confirm({
      title: '删除兑换码',
      content: `确认删除兑换码 ${record.code}？有兑换流水的码建议改为停用以保留统计。`,
      onOk: async () => {
        try {
          const res = await API.delete(`/api/influencer-code/${record.id}`);
          if (res.data.success) {
            showSuccess('已删除');
            loadCodes();
          } else {
            showError(res.data.message || '删除失败');
          }
        } catch (error) {
          showError(error.response?.data?.message || error.message || '删除失败');
        }
      },
    });
  };

  const handleBatchImport = async () => {
    if (!importContent.trim()) {
      showError('请粘贴手机号列表');
      return;
    }
    setImportLoading(true);
    setImportResults(null);
    try {
      const res = await API.post('/api/influencer-code/batch-import', { content: importContent });
      if (res.data.success) {
        setImportResults(res.data.data || []);
        loadCodes();
        loadChannels();
      } else {
        showError(res.data.message || '导入失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '导入失败');
    } finally {
      setImportLoading(false);
    }
  };

  // 导出兑换码列表（默认导出当前筛选后的全部条目；有多选时仅导出选中项）。
  // 导出列与「列配置」可见列同步（操作列除外），始终附带创建时间。
  const exportCsv = (rows) => {
    try {
      const list = rows && rows.length ? rows : codes;
      if (!list.length) {
        showError('没有可导出的兑换码');
        return;
      }
      // 每个可配置列对应的导出表头与取值。
      const exportFields = {
        issuer_phone: { label: '账号（手机号）', get: (r) => r.issuer_phone },
        code: { label: '兑换码', get: (r) => r.code },
        influencer_name: { label: '达人名称', get: (r) => r.influencer_name },
        channel: { label: '渠道', get: (r) => r.channel },
        total_redeemed: { label: '总兑换数', get: (r) => r.total_redeemed || 0 },
        total_valid_count: { label: '总有效数', get: (r) => r.total_valid_count || 0 },
        valid_count: { label: '当期有效数', get: (r) => r.valid_count || 0 },
        current_reward_cents: { label: '当期奖励(元)', get: (r) => ((r.current_reward_cents || 0) / 100).toFixed(2) },
        settled_reward_cents: { label: '已发放奖励(元)', get: (r) => ((r.settled_reward_cents || 0) / 100).toFixed(2) },
        settle_count: { label: '结算次数', get: (r) => r.settle_count || 0 },
        status: { label: '状态', get: (r) => (r.status === STATUS_ENABLED ? '启用' : '停用') },
      };
      // 按列配置顺序取可见列（排除操作列），末尾附创建时间。
      const keys = codeColumnMeta
        .map((m) => m.key)
        .filter((k) => k !== 'op' && exportFields[k] && codeVisibleKeys.includes(k));
      const escape = (v) => {
        const s = v === undefined || v === null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [...keys.map((k) => exportFields[k].label), '创建时间'];
      const lines = list.map((r) =>
        [...keys.map((k) => exportFields[k].get(r)), r.created_time ? timestamp2string(r.created_time) : '']
          .map(escape)
          .join(',')
      );
      const csv = [header.join(','), ...lines].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'influencer_codes.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '导出失败');
    }
  };

  // 批量操作：enable / disable / delete / channel
  const runBatch = async (action, channel) => {
    if (!selectedRowKeys.length) {
      showError('请先选择兑换码');
      return;
    }
    setBatchLoading(true);
    try {
      const payload = { ids: selectedRowKeys, action };
      if (action === 'channel') payload.channel = channel;
      const res = await API.post('/api/influencer-code/batch-operate', payload);
      if (res.data.success) {
        showSuccess('操作成功');
        setSelectedRowKeys([]);
        if (action === 'channel') {
          setChannelVisible(false);
          setChannelValue('');
        }
        loadCodes();
        loadChannels();
      } else {
        showError(res.data.message || '操作失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '操作失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: '批量删除兑换码',
      content: `确认删除选中的 ${selectedRowKeys.length} 个兑换码？有兑换流水的码建议改为停用以保留统计。此操作不可恢复。`,
      type: 'warning',
      onOk: () => runBatch('delete'),
    });
  };

  // ===== 设置弹窗 =====
  const openSettings = async () => {
    setSettingsVisible(true);
    setSettingsLoading(true);
    try {
      // 分群列表
      const cr = await API.get('/api/user-crowd/?page=1&page_size=100');
      if (cr.data.success) setCrowds(cr.data.data || []);
      // 当前设置
      const res = await API.get('/api/reward-rule/settings');
      if (res.data.success) {
        const d = res.data.data || {};
        setSettingsCrowdId(d.crowd_id || 0);
        setPreviewRule(d.rule || null);
        setRuleDesc(d.rule_note || '');
      } else {
        showError(res.data.message || '读取设置失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '读取设置失败');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!ruleDesc.trim()) {
      showError('请输入奖励规则的自然语言描述');
      return;
    }
    setGenerating(true);
    try {
      const res = await API.post('/api/reward-rule/generate', { description: ruleDesc.trim() });
      if (res.data.success) {
        setPreviewRule(res.data.data?.rule || null);
        showSuccess('已生成，请确认规则后保存');
      } else {
        showError(res.data.message || '生成失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await API.put('/api/reward-rule/settings', {
        crowd_id: settingsCrowdId || 0,
        rule: previewRule || null,
      });
      if (res.data.success) {
        showSuccess(res.data.message || '保存成功');
        setSettingsVisible(false);
        loadCodes();
      } else {
        showError(res.data.message || '保存失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '保存失败');
    } finally {
      setSettingsLoading(false);
    }
  };

  // ===== 结算 =====
  const handleSettle = () => {
    const isPartial = selectedRowKeys.length > 0;
    const targetRows = isPartial ? codes.filter((r) => selectedRowKeys.includes(r.id)) : codes;
    const settleable = targetRows.filter((r) => (r.valid_count || 0) > 0 || (r.current_reward_cents || 0) > 0);
    const totalValid = settleable.reduce((s, r) => s + (r.valid_count || 0), 0);
    const totalCents = settleable.reduce((s, r) => s + (r.current_reward_cents || 0), 0);
    if (settleable.length === 0) {
      showError(isPartial ? '所选达人当期无可结算奖励' : '当期无可结算奖励');
      return;
    }
    setSettleSummary({ isPartial, count: settleable.length, totalValid, totalCents });
    setSettlePassword('');
    setSettleVisible(true);
  };

  const confirmSettle = async () => {
    if (!settlePassword.trim()) {
      showError('请输入管理员密码');
      return;
    }
    setSettleLoading(true);
    try {
      const payload = { password: settlePassword };
      if (settleSummary.isPartial) payload.code_ids = selectedRowKeys;
      const res = await API.post('/api/reward-settlement/settle', payload);
      if (res.data.success) {
        showSuccess(res.data.message || '结算成功');
        setSettleVisible(false);
        setSettlePassword('');
        setSelectedRowKeys([]);
        loadCodes();
      } else {
        showError(res.data.message || '结算失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '结算失败');
    } finally {
      setSettleLoading(false);
    }
  };

  // 单码结算历史
  const openHistory = async (record) => {
    setHistoryCode(record);
    setHistoryItems([]);
    setHistoryVisible(true);
    try {
      const res = await API.get(`/api/reward-settlement/by-code?code_id=${record.id}`);
      if (res.data.success) {
        setHistoryItems(res.data.data || []);
      } else {
        showError(res.data.message || '获取结算历史失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '获取结算历史失败');
    }
  };

  // ===== 奖励记录 =====
  const loadSettlements = useCallback(async () => {
    setSettlementsLoading(true);
    try {
      const res = await API.get('/api/reward-settlement/?page=1&page_size=100');
      if (res.data.success) {
        setSettlements(res.data.data || []);
      } else {
        showError(res.data.message || '加载奖励记录失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '加载奖励记录失败');
    } finally {
      setSettlementsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'settlements') loadSettlements();
  }, [tab, loadSettlements]);

  // 解析并展示某批次的当期规则快照（结算时所用规则）。
  const openRuleSnapshot = (batch) => {
    setRuleSnapshotBatch(batch);
    let parsed = null;
    if (batch?.rule_snapshot) {
      try {
        parsed = JSON.parse(batch.rule_snapshot);
      } catch (e) {
        parsed = null;
      }
    }
    setRuleSnapshotData(parsed);
    setRuleSnapshotVisible(true);
  };

  const openItems = async (batch) => {
    setItemsBatch(batch);
    setItemsRows([]);
    setItemsVisible(true);
    try {
      const res = await API.get(`/api/reward-settlement/${batch.id}/items`);
      if (res.data.success) {
        setItemsRows(res.data.data || []);
      } else {
        showError(res.data.message || '获取明细失败');
      }
    } catch (error) {
      showError(error.response?.data?.message || error.message || '获取明细失败');
    }
  };

  const exportItems = (batch, rows) => {
    try {
      if (!rows || !rows.length) {
        showError('没有可导出的明细');
        return;
      }
      const header = ['达人账号', '达人名', '渠道', '有效人数', '奖励金额(元)', '结算时间'];
      const escape = (v) => {
        const s = v === undefined || v === null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const settledAt = batch?.settled_at ? timestamp2string(batch.settled_at) : '';
      const lines = rows.map((r) =>
        [r.issuer_phone, r.influencer_name, r.channel, r.valid_count || 0, ((r.amount_cents || 0) / 100).toFixed(2), settledAt]
          .map(escape)
          .join(',')
      );
      const csv = [header.join(','), ...lines].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reward_settlement_${batch?.batch_no || 'export'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '导出失败');
    }
  };

  const codeColumns = [
    { title: '账号（手机号）', dataIndex: 'issuer_phone' },
    {
      title: '兑换码',
      dataIndex: 'code',
      render: (code) => (
        <Space>
          <Text>{code}</Text>
          <Button size="small" theme="borderless" onClick={() => handleCopyCode(code)}>
            复制
          </Button>
        </Space>
      ),
    },
    { title: '达人名称', dataIndex: 'influencer_name' },
    { title: '渠道', dataIndex: 'channel', render: (v) => v || '-' },
    { title: '总兑换数', dataIndex: 'total_redeemed', render: (v) => v || 0 },
    { title: '总有效数', dataIndex: 'total_valid_count', render: (v) => v || 0 },
    { title: '当期有效数', dataIndex: 'valid_count', render: (v) => v || 0 },
    { title: '当期奖励', dataIndex: 'current_reward_cents', render: (v) => fmtYuan(v) },
    { title: '已发放奖励', dataIndex: 'settled_reward_cents', render: (v) => fmtYuan(v) },
    {
      title: '结算次数',
      dataIndex: 'settle_count',
      render: (v, record) =>
        v > 0 ? (
          <Button size="small" theme="borderless" onClick={() => openHistory(record)}>
            {v}
          </Button>
        ) : (
          <Text type="tertiary">0</Text>
        ),
    },
    { title: '状态', dataIndex: 'status', render: renderStatus },
    {
      title: '操作',
      key: 'op',
      render: (_, record) => (
        <Space>
          <Button size="small" theme="borderless" onClick={() => handleToggleStatus(record)}>
            {record.status === STATUS_ENABLED ? '停用' : '启用'}
          </Button>
          <Button size="small" type="danger" theme="borderless" onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  // 列显示配置（持久化到 localStorage，导出同步可见列）。
  const codeColumnMeta = [
    { key: 'issuer_phone', label: '账号（手机号）', always: true },
    { key: 'code', label: '兑换码', always: true },
    { key: 'influencer_name', label: '达人名称' },
    { key: 'channel', label: '渠道' },
    { key: 'total_redeemed', label: '总兑换数' },
    { key: 'total_valid_count', label: '总有效数' },
    { key: 'valid_count', label: '当期有效数' },
    { key: 'current_reward_cents', label: '当期奖励' },
    { key: 'settled_reward_cents', label: '已发放奖励' },
    { key: 'settle_count', label: '结算次数' },
    { key: 'status', label: '状态' },
    { key: 'op', label: '操作', always: true },
  ];
  const { visibleColumns: codeVisibleColumns, columnConfigButton: codeColumnConfigButton, visibleKeys: codeVisibleKeys } = useColumnConfig({
    storageKey: 'influencer_code_table_visible_columns',
    columnMeta: codeColumnMeta,
    allColumns: codeColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const settlementColumns = [
    { title: '批次号', dataIndex: 'batch_no' },
    { title: '结算时间', dataIndex: 'settled_at', render: (v) => (v ? timestamp2string(v) : '-') },
    { title: '达人数', dataIndex: 'influencer_count' },
    { title: '有效人数合计', dataIndex: 'total_valid_count' },
    { title: '金额合计', dataIndex: 'total_amount_cents', render: (v) => fmtYuan(v) },
    { title: '结算范围', dataIndex: 'is_partial', render: (v) => (v ? <Tag color="orange">部分</Tag> : <Tag color="blue">全量</Tag>) },
    { title: '结算人', dataIndex: 'settled_by_name', render: (v) => v || '-' },
    {
      title: '当期规则',
      dataIndex: 'rule_snapshot',
      render: (snapshot, record) => (
        <Button size="small" theme="borderless" onClick={() => openRuleSnapshot(record)}>
          查看规则
        </Button>
      ),
    },
    {
      title: '操作',
      render: (_, record) => (
        <Button size="small" theme="borderless" onClick={() => openItems(record)}>
          查看明细
        </Button>
      ),
    },
  ];

  const settleButtonText = selectedRowKeys.length > 0 ? `结算所选（${selectedRowKeys.length}）` : '结算奖励';

  return (
    <div style={{ paddingTop: 12 }}>
      <ConfigPageTabs activeKey={tab} onChange={setTab} style={{ marginBottom: 12 }}>
        <ConfigPageTabPane tab="兑换码管理" itemKey="codes" />
        <ConfigPageTabPane tab="奖励记录" itemKey="settlements" />
      </ConfigPageTabs>

      {tab === 'codes' && (
        <>
          <Banner
            type="info"
            closeIcon={null}
            description="平台额度由「活动管理」页的 redeem 活动发放；本页的「当期奖励 / 已发放奖励」是给达人的现金返佣（元），仅作财务台账与导出，不触发任何资金动作。有效人群与奖励规则在「设置」中统一配置。"
            style={{ marginBottom: 12 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
            <Space>
              <Input prefix="达人" placeholder="按达人名筛选" value={filterName} onChange={setFilterName} style={{ width: 160 }} showClear />
              <Input prefix="渠道" placeholder="按渠道筛选" value={filterChannel} onChange={setFilterChannel} style={{ width: 160 }} showClear />
              <Button icon={<IconRefresh />} onClick={loadCodes}>
                刷新
              </Button>
            </Space>
            <Space>
              <Button icon={<IconSetting />} onClick={openSettings}>
                设置
              </Button>
              <Button icon={<IconPlus />} theme="solid" onClick={() => setCreateVisible(true)}>
                新建
              </Button>
              <Button onClick={() => { setImportVisible(true); setImportResults(null); setImportContent(''); }}>
                批量导入
              </Button>
              <Button theme="solid" type="primary" loading={settleLoading} onClick={handleSettle}>
                {settleButtonText}
              </Button>
              <Button onClick={() => exportCsv()}>导出</Button>
              {codeColumnConfigButton}
            </Space>
          </div>
          {selectedRowKeys.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
                padding: '8px 12px',
                background: 'var(--semi-color-fill-0)',
                borderRadius: 8,
              }}
            >
              <Text>已选 {selectedRowKeys.length} 项</Text>
              <Button size="small" loading={batchLoading} onClick={() => runBatch('enable')}>
                批量启用
              </Button>
              <Button size="small" loading={batchLoading} onClick={() => runBatch('disable')}>
                批量停用
              </Button>
              <Button size="small" loading={batchLoading} onClick={() => { setChannelValue(''); setChannelVisible(true); }}>
                修改渠道
              </Button>
              <Button size="small" onClick={() => exportCsv(codes.filter((r) => selectedRowKeys.includes(r.id)))}>
                导出所选
              </Button>
              <Button size="small" type="danger" loading={batchLoading} onClick={handleBatchDelete}>
                批量删除
              </Button>
              <Button size="small" theme="borderless" onClick={() => setSelectedRowKeys([])}>
                取消选择
              </Button>
            </div>
          )}
          <Table
            columns={codeVisibleColumns}
            dataSource={codes}
            loading={codesLoading}
            rowKey="id"
            pagination={{ pageSize: 20 }}
            rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          />
        </>
      )}

      {tab === 'settlements' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button icon={<IconRefresh />} onClick={loadSettlements}>
              刷新
            </Button>
          </div>
          <Table columns={settlementColumns} dataSource={settlements} loading={settlementsLoading} rowKey="id" pagination={{ pageSize: 20 }} />
        </>
      )}

      {/* 新建弹窗 */}
      <Modal title="新建兑换码" visible={createVisible} onCancel={() => setCreateVisible(false)} onOk={handleCreate} confirmLoading={createLoading}>
        <Banner
          type="warning"
          closeIcon={null}
          description="手机号未注册时将自动创建 Parvis 账号（账号=手机号，默认密码 p+手机号），并默认打「运营」标签（标签不存在则跳过）。"
          style={{ marginBottom: 12 }}
        />
        <Form labelPosition="left" labelWidth={90}>
          <Form.Input field="phone" label="达人手机号" placeholder="11 位手机号，必填" initValue={createForm.phone} onChange={(v) => setCreateForm((f) => ({ ...f, phone: v }))} />
          <Form.Input field="influencer_name" label="达人名称" placeholder="可选，缺省取 P_手机号" initValue={createForm.influencer_name} onChange={(v) => setCreateForm((f) => ({ ...f, influencer_name: v }))} />
          <Form.Slot label="投放渠道" required>
            <AutoComplete
              data={channelOptions}
              value={createForm.channel}
              placeholder="必填，可输入新渠道或选择已有渠道"
              onChange={(v) => setCreateForm((f) => ({ ...f, channel: v }))}
              onSelect={(v) => setCreateForm((f) => ({ ...f, channel: v }))}
              style={{ width: '100%' }}
              showClear
            />
          </Form.Slot>
        </Form>
      </Modal>

      {/* 批量导入弹窗 */}
      <Modal title="批量导入兑换码" visible={importVisible} onCancel={() => setImportVisible(false)} onOk={handleBatchImport} confirmLoading={importLoading} okText="开始导入" width={560}>
        <Text type="tertiary">
          每行一条，格式 <Text code>手机号,达人名,渠道</Text>，逗号或制表符分隔。手机号与渠道必填，达人名可留空（如 <Text code>手机号,,渠道</Text>）。同一手机号不同渠道可各建一码。无奖励配置（在活动页统一配）。
        </Text>
        <TextArea rows={8} style={{ marginTop: 12 }} placeholder={'13800000000,张三,douyin\n13900000001,李四,xiaohongshu\n13700000002,,bilibili'} value={importContent} onChange={setImportContent} />
        {importResults && (
          <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto' }}>
            <Title heading={6}>导入结果</Title>
            {importResults.map((r, i) => (
              <div key={i} style={{ fontSize: 13, padding: '2px 0' }}>
                <Tag color={r.success ? 'green' : 'red'} size="small">
                  {r.success ? '成功' : '失败'}
                </Tag>
                <Text style={{ marginLeft: 6 }}>{r.phone}</Text>
                <Text type="tertiary" style={{ marginLeft: 6 }}>
                  {r.success ? `码 ${r.code}` : r.message}
                </Text>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 批量修改渠道弹窗 */}
      <Modal title="批量修改渠道" visible={channelVisible} onCancel={() => setChannelVisible(false)} onOk={() => runBatch('channel', channelValue.trim())} confirmLoading={batchLoading} okText="确认修改">
        <Text type="tertiary">将选中的 {selectedRowKeys.length} 个兑换码的渠道统一改为：</Text>
        <AutoComplete data={channelOptions} style={{ marginTop: 12, width: '100%' }} placeholder="可输入新渠道或选择已有渠道，留空表示清空渠道" value={channelValue} onChange={setChannelValue} onSelect={setChannelValue} showClear />
      </Modal>

      {/* 设置弹窗：有效人群 + 奖励规则 */}
      <Modal title="奖励设置" visible={settingsVisible} onCancel={() => setSettingsVisible(false)} onOk={handleSaveSettings} confirmLoading={settingsLoading} okText="保存" width={620}>
        <Spin spinning={settingsLoading}>
          <div style={{ marginBottom: 16 }}>
            <Title heading={6}>有效人群</Title>
            <Text type="tertiary" size="small">
              兑换某达人码的用户中，命中该分群的人数计为「有效人数」。不选＝全部兑换人都算有效。
            </Text>
            <div style={{ marginTop: 8 }}>
              <Select value={settingsCrowdId} onChange={setSettingsCrowdId} style={{ width: '100%' }} placeholder="选择有效人群分群">
                <Select.Option value={0}>不过滤（全部兑换人都算有效）</Select.Option>
                {crowds.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}（{c.user_count ?? 0} 人）
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Title heading={6}>奖励规则</Title>
            <Text type="tertiary" size="small">
              用自然语言描述返佣规则（如「每有效用户 5 元，满 100 人后每人 8 元」），点「生成」由 AI 翻译为结构化规则，确认后保存。保存即生效，不回算已发放。
            </Text>
            <TextArea rows={3} style={{ marginTop: 8 }} placeholder="例如：每个有效用户返 5 元，满 100 人后每人 8 元" value={ruleDesc} onChange={setRuleDesc} />
            <div style={{ marginTop: 8 }}>
              <Button loading={generating} onClick={handleGenerate}>
                生成规则
              </Button>
            </div>
            <div style={{ marginTop: 12, padding: 12, background: 'var(--semi-color-fill-0)', borderRadius: 8 }}>
              <Text strong>规则预览</Text>
              <div style={{ marginTop: 6 }}>
                <RulestructPreview rule={previewRule} />
              </div>
            </div>
          </div>
        </Spin>
      </Modal>

      {/* 结算二次确认弹窗（需管理员密码） */}
      <Modal
        title={settleSummary.isPartial ? '结算所选奖励' : '结算全部奖励'}
        visible={settleVisible}
        onCancel={() => setSettleVisible(false)}
        onOk={confirmSettle}
        confirmLoading={settleLoading}
        okText="确认结算"
      >
        <Banner
          type="warning"
          closeIcon={null}
          description="结算后当期归零并归档到奖励记录，不可撤销。请输入您的管理员密码二次确认。"
          style={{ marginBottom: 12 }}
        />
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          将结算 <Text strong>{settleSummary.count}</Text> 个达人，合计有效人数{' '}
          <Text strong>{settleSummary.totalValid}</Text>，合计金额{' '}
          <Text strong>{fmtYuan(settleSummary.totalCents)}</Text>。
        </div>
        <Input
          mode="password"
          placeholder="请输入管理员密码"
          value={settlePassword}
          onChange={setSettlePassword}
          onEnterPress={confirmSettle}
        />
      </Modal>

      {/* 单码结算历史弹窗 */}
      <Modal title={`结算历史 — ${historyCode?.influencer_name || ''} ${historyCode?.code || ''}`} visible={historyVisible} onCancel={() => setHistoryVisible(false)} footer={null} width={560}>
        <Table
          size="small"
          pagination={false}
          dataSource={historyItems}
          rowKey="id"
          columns={[
            { title: '结算时间', dataIndex: 'settled_at', render: (v) => (v ? timestamp2string(v) : '-') },
            { title: '批次号', dataIndex: 'batch_no' },
            { title: '有效人数', dataIndex: 'valid_count' },
            { title: '奖励金额', dataIndex: 'amount_cents', render: (v) => fmtYuan(v) },
          ]}
        />
      </Modal>

      {/* 结算批次明细弹窗 */}
      <Modal
        title={`结算明细 — ${itemsBatch?.batch_no || ''}`}
        visible={itemsVisible}
        onCancel={() => setItemsVisible(false)}
        width={720}
        footer={
          <Space>
            <Button onClick={() => setItemsVisible(false)}>关闭</Button>
            <Button theme="solid" onClick={() => exportItems(itemsBatch, itemsRows)}>
              导出
            </Button>
          </Space>
        }
      >
        <Table
          size="small"
          pagination={false}
          dataSource={itemsRows}
          rowKey="id"
          columns={[
            { title: '达人账号', dataIndex: 'issuer_phone' },
            { title: '达人名', dataIndex: 'influencer_name' },
            { title: '渠道', dataIndex: 'channel', render: (v) => v || '-' },
            { title: '有效人数', dataIndex: 'valid_count' },
            { title: '奖励金额', dataIndex: 'amount_cents', render: (v) => fmtYuan(v) },
          ]}
        />
      </Modal>

      {/* 当期规则快照弹窗 */}
      <Modal
        title={`当期规则 — ${ruleSnapshotBatch?.batch_no || ''}`}
        visible={ruleSnapshotVisible}
        onCancel={() => setRuleSnapshotVisible(false)}
        footer={<Button onClick={() => setRuleSnapshotVisible(false)}>关闭</Button>}
        width={560}
      >
        {ruleSnapshotBatch?.crowd_name && (
          <div style={{ marginBottom: 8 }}>
            <Text strong>有效人群：</Text>
            <Text>{ruleSnapshotBatch.crowd_name}</Text>
          </div>
        )}
        {ruleSnapshotData ? (
          <RulestructPreview rule={ruleSnapshotData} />
        ) : (
          <Text type="tertiary">本批次结算时无奖励规则（当期奖励按 0 计）。</Text>
        )}
      </Modal>
    </div>
  );
}
