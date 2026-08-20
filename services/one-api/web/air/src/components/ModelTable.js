import React, { useState } from 'react';
import {
  Table, Button, Input, Select, Tag, Space, Popconfirm, Modal, InputNumber, Tooltip, Checkbox,
} from '@douyinfe/semi-ui';
import { ConfigPageFooter } from './ConfigPageLayout';

// 模型配置表格:多选批量操作 + 部分行编辑 + 拖拽排序。
const ModelTable = ({
  loading, rows, rowCandidates, editingSet, editing, drafts, setField,
  selectedKeys, setSelectedKeys,
  startEdit, startEditSelected, cancelEdit, saveRow, saveAll,
  deleteModel, testModel, toggleEnabled,
  batchSetEnabled, batchDelete, batchTest,
  testResults, setTestResults, reload, onDragStart, onDrop,
  sortMode, enterSortMode, saveSortMode, cancelSortMode,
  createModel, fetchCandidateChannels, createAlias, channelModelNames,
}) => {
  const isEditing = (row) => editingSet.includes(row.name);
  const draftOf = (row) => drafts[row.name] || {};
  const hasSelection = selectedKeys.length > 0;

  // 新增/复制模型弹窗
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', display_name: '', model_type: 'chat', context_limit: 1000000, model_ratio: 1, completion_ratio: 1, sourceChannelIds: [] });
  const [candidates, setCandidates] = useState([]);
  const setCreate = (k, v) => setCreateForm((f) => ({ ...f, [k]: v }));

  const probeCandidates = async (name) => { setCandidates(await fetchCandidateChannels(name)); };

  // 判断输入的模型名是否已存在于模型定义中:
  // - 命中真实模型 → 切到「入口模式」,只录显示名指向它(自动生成内部 id)
  // - 命中别名 → 入口指向它的最终目标,避免链式跳转
  // - 未命中 → 维持新增真实模型流程
  const findExisting = (name) => (rows || []).find((r) => r.name === (name || '').trim());
  const existingRow = findExisting(createForm.name);
  // 复制场景(enabled === false 且预填了渠道/倍率)不切入口模式
  const isCopy = createForm.enabled === false;
  const isEntryMode = !!existingRow && !isCopy;
  const entryTarget = existingRow ? (existingRow.redirect_to || existingRow.name) : '';
  // 入口模式下倍率是「目标真实模型」的全局倍率:从目标行实时读取,作为输入框基准值
  const targetRow = entryTarget ? (rows || []).find((r) => r.name === entryTarget) : null;
  const targetModelRatio = targetRow?.model_ratio ?? 1;
  const targetCompletionRatio = targetRow?.completion_ratio ?? 1;
  // 用户是否在入口模式下手动改过倍率(改过才写回,否则保持目标原值不动)
  const [entryRatioTouched, setEntryRatioTouched] = useState(false);
  const [entryRatio, setEntryRatio] = useState({ model_ratio: 1, completion_ratio: 1 });
  // 入口模式输入框显示值:改过用用户值,否则实时跟随目标
  const entryModelRatio = entryRatioTouched ? entryRatio.model_ratio : targetModelRatio;
  const entryCompletionRatio = entryRatioTouched ? entryRatio.completion_ratio : targetCompletionRatio;

  const openCreate = () => {
    setCreateForm({ name: '', display_name: '', model_type: 'chat', context_limit: 1000000, model_ratio: 1, completion_ratio: 1, sourceChannelIds: [] });
    setCandidates([]);
    setEntryRatioTouched(false);
    setShowCreate(true);
  };
  const openCopy = async (row) => {
    setCreateForm({
      name: row.name, display_name: `${row.display_name || row.name}copy`,
      model_type: row.model_type || 'chat', context_limit: row.context_limit || 0,
      model_ratio: row.model_ratio ?? 0, completion_ratio: row.completion_ratio ?? 0,
      enabled: false, sourceChannelIds: (row.sources || []).map((s) => s.channel_id),
    });
    setShowCreate(true);
    probeCandidates(row.name);
  };
  const submitCreate = async () => {
    // 模型名已存在 → 走「新增显示入口」:为已有模型再加一个客户端展示入口
    const ok = isEntryMode
      ? await createAlias({
          display_name: createForm.display_name, redirect_to: entryTarget, model_type: createForm.model_type,
          // 仅当用户改过倍率才回写目标模型(全局生效);未改则不动,避免冲掉目标原值
          ...(entryRatioTouched ? { model_ratio: entryRatio.model_ratio, completion_ratio: entryRatio.completion_ratio } : {}),
        })
      : await createModel(createForm);
    if (ok) { setShowCreate(false); setCreateForm({ name: '', display_name: '', model_type: 'chat', context_limit: 1000000, model_ratio: 1, completion_ratio: 1, sourceChannelIds: [] }); setCandidates([]); }
  };

  const columns = [
    {
      title: '显示名', dataIndex: 'display_name', width: 150,
      render: (text, row) => isEditing(row)
        ? <Input size="small" value={draftOf(row).display_name} onChange={(v) => setField(row.name, 'display_name', v)} />
        : (text || '-'),
    },
    {
      title: '模型名 (ID)', dataIndex: 'name', width: 220,
      render: (text, row) => (
        <span style={{ fontFamily: 'JetBrains Mono, Consolas' }}>
          {text}
          {row.redirect_to && <Tag size="small" color="violet" type="light" style={{ marginLeft: 6 }}>入口→{row.redirect_to}</Tag>}
        </span>
      ),
    },
    {
      title: '类型', dataIndex: 'model_type', width: 110,
      render: (text, row) => isEditing(row)
        ? (
          <Select size="small" style={{ width: 96 }} value={draftOf(row).model_type || 'chat'}
            onChange={(v) => setField(row.name, 'model_type', v)}
            optionList={[{ label: '对话', value: 'chat' }, { label: '其他', value: 'other' }]} />
        )
        : <Tag color={text === 'other' ? 'grey' : 'blue'} type="light">{text === 'other' ? '其他' : '对话'}</Tag>,
    },
    {
      title: '渠道来源', dataIndex: 'sources', width: 260,
      render: (sources, row) => isEditing(row)
        ? (
          <Select multiple filter size="small" style={{ width: '100%' }}
            placeholder={(rowCandidates?.[row.name] || []).length ? '选择渠道来源' : '无支持该模型的渠道'}
            optionList={rowCandidates?.[row.name] || []} value={draftOf(row).sourceChannelIds}
            onChange={(v) => setField(row.name, 'sourceChannelIds', v)} />
        )
        : (
          <Space wrap>
            {(sources || []).length === 0 && <span style={{ color: '#999' }}>无来源</span>}
            {(sources || []).map((s) => (
              <Tag key={s.channel_id} color={s.enabled ? 'green' : 'grey'} type="light">{s.channel_name || `#${s.channel_id}`}</Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '模型倍率', dataIndex: 'model_ratio', width: 100,
      render: (text, row) => isEditing(row)
        ? <InputNumber size="small" value={draftOf(row).model_ratio} onChange={(v) => setField(row.name, 'model_ratio', v)} style={{ width: 84 }} />
        : (text ?? 0),
    },
    {
      title: '补全倍率', dataIndex: 'completion_ratio', width: 100,
      render: (text, row) => isEditing(row)
        ? <InputNumber size="small" value={draftOf(row).completion_ratio} onChange={(v) => setField(row.name, 'completion_ratio', v)} style={{ width: 84 }} />
        : (text ?? 0),
    },
    {
      title: '上下文限制', dataIndex: 'context_limit', width: 120,
      render: (text, row) => isEditing(row)
        ? <InputNumber size="small" value={draftOf(row).context_limit} onChange={(v) => setField(row.name, 'context_limit', v)} style={{ width: 104 }} />
        : (text ?? 0),
    },
    {
      title: (
        <Tooltip content="勾选后，网关会为该模型注入显式 prompt cache 标记（阿里云百炼 qwen/glm 等支持），确定性命中缓存、降低输入成本。仅对支持显式缓存的模型勾选。">
          <span>显示缓存</span>
        </Tooltip>
      ),
      dataIndex: 'support_explicit_cache', width: 100,
      render: (val, row) => isEditing(row)
        ? <Checkbox checked={!!draftOf(row).support_explicit_cache} onChange={(e) => setField(row.name, 'support_explicit_cache', e.target.checked)} />
        : (val ? <Tag color="blue" type="light">已开</Tag> : <Tag color="grey" type="light">关</Tag>),
    },
    {
      title: '状态', dataIndex: 'enabled', width: 80,
      render: (enabled) => <Tag color={enabled ? 'green' : 'grey'} type="light">{enabled ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '操作', dataIndex: 'op', width: 300,
      render: (_, row) => isEditing(row)
        ? (
          <Space>
            <Popconfirm title="确认保存该模型配置?" position="topRight" onConfirm={() => saveRow(row.name)}>
              <Button size="small" theme="solid" type="primary">保存</Button>
            </Popconfirm>
            <Button size="small" onClick={cancelEdit}>取消</Button>
          </Space>
        )
        : (
          <Space>
            <Button size="small" disabled={sortMode || editing} onClick={() => startEdit(row)}>编辑</Button>
            <Button size="small" disabled={sortMode || editing} onClick={() => openCopy(row)}>复制</Button>
            <Button size="small" disabled={sortMode || editing} onClick={() => testModel(row)}>测试</Button>
            {row.enabled
              ? (
                <Popconfirm title="确认禁用该模型?" content="禁用后客户端将不再下发该模型。" position="topRight" onConfirm={() => toggleEnabled(row)}>
                  <Button size="small" type="warning" disabled={sortMode || editing}>禁用</Button>
                </Popconfirm>
              )
              : <Button size="small" type="secondary" disabled={sortMode || editing} onClick={() => toggleEnabled(row)}>启用</Button>}
            {row.enabled
              ? (
                <Tooltip content="启用中的模型不可删除,请先禁用" position="left" autoAdjustOverflow>
                  <span style={{ display: 'inline-flex', cursor: 'not-allowed' }}>
                    <Button size="small" type="danger" disabled style={{ pointerEvents: 'none' }}>删除</Button>
                  </span>
                </Tooltip>
              )
              : (
                <Popconfirm title="确认删除该模型?" position="topRight" onConfirm={() => deleteModel(row)}>
                  <Button size="small" type="danger" disabled={sortMode || editing}>删除</Button>
                </Popconfirm>
              )}
          </Space>
        ),
    },
  ];

  // 拖拽:仅排序模式下生效
  const onRow = (record, index) => {
    if (!sortMode) return {};
    return {
      draggable: true,
      onDragStart: () => onDragStart(index),
      onDragOver: (e) => e.preventDefault(),
      onDrop: () => onDrop(index),
      style: { cursor: 'move' },
    };
  };

  // 多选(编辑/排序态下禁用勾选,避免误操作)
  const rowSelection = (sortMode || editing) ? undefined : {
    selectedRowKeys: selectedKeys,
    onChange: (keys) => setSelectedKeys(keys),
  };

  return (
    <div className="model-config-wrap">
      <div style={{ flex: '1 0 auto' }}>
      <div style={{ marginBottom: 12 }}>
        {sortMode ? (
          <Space>
            <Button theme="solid" type="primary" onClick={saveSortMode}>保存排序</Button>
            <Button theme="light" onClick={cancelSortMode}>取消</Button>
            <span style={{ color: '#fa8c16', fontSize: 12 }}>排序模式:拖拽行调整顺序,保存前不可进行其他操作</span>
          </Space>
        ) : editing ? (
          <Space>
            <span style={{ color: '#007AFF', fontSize: 12 }}>编辑模式:修改后点底部「保存全部」,或各行单独保存</span>
          </Space>
        ) : hasSelection ? (
          <Space>
            <span style={{ fontSize: 13 }}>已选 {selectedKeys.length} 项</span>
            <Button size="small" theme="solid" type="primary" onClick={startEditSelected}>编辑</Button>
            <Button size="small" type="secondary" onClick={() => batchSetEnabled(true)}>启用</Button>
            <Popconfirm title={`确认禁用选中的 ${selectedKeys.length} 个模型?`} content="禁用后客户端将不再下发这些模型。" onConfirm={() => batchSetEnabled(false)}>
              <Button size="small" type="warning">禁用</Button>
            </Popconfirm>
            <Button size="small" onClick={batchTest}>测试</Button>
            <Popconfirm title={`确认删除选中的 ${selectedKeys.length} 个模型?`} content="启用中的模型不会被删除,请先禁用。" onConfirm={batchDelete}>
              <Button size="small" type="danger">删除</Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedKeys([])}>取消选择</Button>
          </Space>
        ) : (
          <Space>
            <Button theme="solid" type="primary" onClick={openCreate}>新增模型</Button>
            <Button theme="light" type="primary" onClick={reload}>刷新</Button>
            <Button theme="light" type="tertiary" onClick={enterSortMode}>排序</Button>
          </Space>
        )}
      </div>
      <Table
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowKey="name"
        pagination={false}
        size="small"
        onRow={onRow}
        rowSelection={rowSelection}
      />
      </div>
      {editing && (
        <ConfigPageFooter
          dirty loading={loading}
          hint={`编辑中:${editingSet.length} 个模型,保存将提交所有修改`}
          saveText="保存全部" onSave={saveAll} onCancel={cancelEdit}
        />
      )}

      <Modal title={isEntryMode ? '新增显示入口' : (createForm.enabled === false ? '复制模型' : '新增模型')} visible={showCreate}
        onCancel={() => setShowCreate(false)} onOk={submitCreate} okText="创建" cancelText="取消">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4, fontSize: 13 }}>模型名 (ID,渠道可识别的真实模型名)</div>
            <Select filter allowCreate style={{ width: '100%' }}
              placeholder="搜索渠道已有模型,或直接输入新模型名"
              optionList={channelModelNames} value={createForm.name || undefined}
              onChange={(v) => {
                setCreate('name', v);
                probeCandidates((v || '').trim());
                // 切换模型名时重置「倍率已改」标记,新模型下倍率默认跟随其目标实时值
                setEntryRatioTouched(false);
              }} />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 13 }}>显示名</div>
            <Input value={createForm.display_name} onChange={(v) => setCreate('display_name', v)} placeholder="对外展示名,可留空" />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 13 }}>类型</div>
            <Select style={{ width: 160 }} value={createForm.model_type} onChange={(v) => setCreate('model_type', v)}
              optionList={[{ label: '对话', value: 'chat' }, { label: '其他', value: 'other' }]} />
          </div>
          {isEntryMode && (
            <>
              <div style={{ fontSize: 12, color: '#007AFF', background: 'rgba(0,122,255,0.06)', border: '1px solid rgba(0,122,255,0.15)', borderRadius: 6, padding: '8px 10px' }}>
                「{createForm.name}」已存在,将为它新增一个客户端显示入口,实际调用指向 {entryTarget}。内部标识自动生成,无需配置渠道。
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13 }}>模型倍率</div>
                  <InputNumber value={entryModelRatio} onChange={(v) => { setEntryRatioTouched(true); setEntryRatio((r) => ({ ...r, model_ratio: v })); }} style={{ width: 160 }} min={0.1} step={0.1} />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13 }}>补全倍率</div>
                  <InputNumber value={entryCompletionRatio} onChange={(v) => { setEntryRatioTouched(true); setEntryRatio((r) => ({ ...r, completion_ratio: v })); }} style={{ width: 160 }} min={0.1} step={0.1} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#FF9F0A' }}>
                倍率按模型 ID 全局唯一:此处修改会同步应用到「{entryTarget}」及其所有显示入口,不可单独为本入口设置。
              </div>
            </>
          )}
          {!isEntryMode && (
            <>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>上下文限制</div>
                <InputNumber value={createForm.context_limit} onChange={(v) => setCreate('context_limit', v)} style={{ width: 160 }} min={0} />
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13 }}>模型倍率</div>
                  <InputNumber value={createForm.model_ratio} onChange={(v) => setCreate('model_ratio', v)} style={{ width: 160 }} min={0.1} step={0.1} />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13 }}>补全倍率</div>
                  <InputNumber value={createForm.completion_ratio} onChange={(v) => setCreate('completion_ratio', v)} style={{ width: 160 }} min={0.1} step={0.1} />
                </div>
              </div>
              <div>
                <div style={{ marginBottom: 4, fontSize: 13 }}>渠道来源(可选,按模型名探测支持该模型的渠道)</div>
                <Select multiple filter style={{ width: '100%' }}
                  placeholder={candidates.length ? '选择渠道来源' : '选模型名后自动探测,或无支持该模型的渠道'}
                  optionList={candidates} value={createForm.sourceChannelIds}
                  onChange={(v) => setCreate('sourceChannelIds', v)} />
              </div>
            </>
          )}
          <div style={{ fontSize: 12, color: '#999' }}>
            {isEntryMode ? '显示入口默认禁用,确认无误后在列表手动启用。' : (createForm.enabled === false ? '复制的模型默认禁用,确认后可在列表启用。' : '新建模型默认禁用,确认无误后在列表手动启用。可不选来源,创建后在列表「编辑」里再挂渠道。')}
          </div>
        </div>
      </Modal>

      <Modal title="模型连通性测试" visible={!!testResults} onCancel={() => setTestResults(null)}
        footer={<Button onClick={() => setTestResults(null)}>关闭</Button>} width={520}>
        {testResults?.loading && <div>测试中…</div>}
        {!testResults?.loading && (testResults?.models || []).map((m) => (
          <div key={m.model} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, fontFamily: 'JetBrains Mono, Consolas' }}>{m.model}</div>
            {((testResults.data || {})[m.model] || []).map((r, i) => (
              <div key={i} style={{ marginBottom: 4, paddingLeft: 8 }}>
                <Tag color={r.success ? 'green' : 'red'} type="light">{r.success ? '成功' : '失败'}</Tag>
                <span style={{ marginLeft: 8 }}>{r.channel_name || ''}</span>
                <span style={{ marginLeft: 8, color: '#999' }}>{r.success ? `${r.time}s` : r.message}</span>
              </div>
            ))}
            {((testResults.data || {})[m.model] || []).length === 0 && <div style={{ paddingLeft: 8, color: '#999' }}>无渠道来源</div>}
          </div>
        ))}
      </Modal>
    </div>
  );
};

export default ModelTable;
