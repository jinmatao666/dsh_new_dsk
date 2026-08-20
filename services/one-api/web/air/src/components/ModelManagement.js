import React, { useEffect, useState } from 'react';
import { API, showError, showSuccess } from '../helpers';
import ModelTable from './ModelTable';

// 模型配置 —— 列表 + 行内编辑 + 批量编辑 + 拖拽排序。
//
// 数据来自聚合接口 /api/model_definition/aggregated:
//   每行 = ModelDefinition 元数据 + ability 渠道来源(sources) + options 倍率/上下文。
// 两种编辑模式:
//   - 单行编辑:点某行「编辑」,仅该行进入编辑态。
//   - 批量编辑:点「批量编辑」,所有行同时进入编辑态,底部统一「保存全部」。
// 拖拽行可调整显示顺序,保存到后端 sort 字段(PUT /reorder)。
const ModelManagement = () => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]); // 多选行(模型名)
  const [editingSet, setEditingSet] = useState([]);      // 处于编辑态的模型名集合
  const [drafts, setDrafts] = useState({});              // name -> 草稿
  const [rowCandidates, setRowCandidates] = useState({}); // name -> 支持该模型的候选渠道[{label,value}]
  const [testResults, setTestResults] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [sortMode, setSortMode] = useState(false); // 排序模式:仅此模式可拖拽,其余操作禁用

  const loadModels = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/model_definition/aggregated');
      const { success, message, data } = res.data;
      if (success) setRows(data || []);
      else showError(message);
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadModels(); }, []);

  const makeDraft = (row) => ({
    id: row.id,
    name: row.name,
    display_name: row.display_name || '',
    remark: row.remark || '',
    enabled: row.enabled,
    model_type: row.model_type || 'chat',
    model_ratio: row.model_ratio ?? 0,
    completion_ratio: row.completion_ratio ?? 0,
    context_limit: row.context_limit ?? 0,
    support_explicit_cache: row.support_explicit_cache || false,
    in_model_def: row.in_model_def,
    sourceChannelIds: (row.sources || []).map((s) => s.channel_id),
    originSourceChannelIds: (row.sources || []).map((s) => s.channel_id),
  });

  const editing = editingSet.length > 0;

  // 进入编辑态时,为每个模型探测「支持该模型的渠道」候选,渠道来源下拉据此筛选,
  // 避免选到不支持该模型的渠道。已挂的来源合并进候选,保证现有选择能正常显示。
  const loadRowCandidates = async (targetRows) => {
    const entries = await Promise.all(targetRows.map(async (r) => {
      // 别名入口按其指向的真实模型探测
      const probeName = r.redirect_to || r.name;
      const cand = await fetchCandidateChannels(probeName);
      const byId = new Map(cand.map((c) => [c.value, c]));
      (r.sources || []).forEach((s) => {
        if (!byId.has(s.channel_id)) byId.set(s.channel_id, { label: `${s.channel_name || `#${s.channel_id}`} (#${s.channel_id})`, value: s.channel_id });
      });
      return [r.name, Array.from(byId.values())];
    }));
    setRowCandidates((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  };

  // 单行编辑:把该行加入编辑集
  const startEdit = (row) => {
    setEditingSet([row.name]);
    setDrafts({ [row.name]: makeDraft(row) });
    loadRowCandidates([row]);
  };

  // 批量编辑:把选中的行全部进入编辑态(部分编辑);未选则提示
  const startEditSelected = () => {
    if (!selectedKeys.length) { showError('请先勾选要编辑的模型'); return; }
    const d = {};
    const targets = rows.filter((r) => selectedKeys.includes(r.name));
    targets.forEach((r) => { d[r.name] = makeDraft(r); });
    setDrafts(d);
    setEditingSet([...selectedKeys]);
    loadRowCandidates(targets);
  };

  const cancelEdit = () => {
    setEditingSet([]);
    setDrafts({});
  };

  const setField = (name, k, v) =>
    setDrafts((d) => ({ ...d, [name]: { ...d[name], [k]: v } }));

  // 保存单个草稿(模型主表 + 渠道来源 diff + 倍率 options)
  const persistDraft = async (draft) => {
    let r;
    if (draft.in_model_def) {
      r = await API.put('/api/model_definition/', {
        id: draft.id, name: draft.name, display_name: draft.display_name,
        remark: draft.remark, enabled: draft.enabled, model_type: draft.model_type || 'chat',
        context_limit: Number(draft.context_limit) || 0,
        support_explicit_cache: !!draft.support_explicit_cache,
      });
    } else {
      r = await API.post('/api/model_definition/', {
        name: draft.name, display_name: draft.display_name,
        remark: draft.remark, enabled: draft.enabled, model_type: draft.model_type || 'chat',
        context_limit: Number(draft.context_limit) || 0,
        support_explicit_cache: !!draft.support_explicit_cache,
      });
    }
    if (!r.data.success) throw new Error(r.data.message || '保存模型失败');
    const cur = new Set(draft.sourceChannelIds);
    const origin = new Set(draft.originSourceChannelIds);
    for (const id of [...cur].filter((x) => !origin.has(x))) {
      const r = await API.post('/api/model_definition/source', { model: draft.name, channel_id: id, group: 'default' });
      if (!r.data.success) throw new Error(r.data.message || '挂渠道来源失败');
    }
    for (const id of [...origin].filter((x) => !cur.has(x))) {
      const r = await API.delete('/api/model_definition/source', { data: { model: draft.name, channel_id: id, group: 'default' } });
      if (!r.data.success) throw new Error(r.data.message || '移除渠道来源失败');
    }
    await saveRatioForModel(draft.name, Number(draft.model_ratio) || 0, Number(draft.completion_ratio) || 0);
  };

  const saveRow = async (name) => {
    const draft = drafts[name];
    if (!draft) return;
    try {
      await persistDraft(draft);
      showSuccess('保存成功');
      cancelEdit();
      loadModels();
    } catch (e) { showError(e.message); }
  };

  // 批量保存:逐个持久化所有处于编辑态的草稿
  const saveAll = async () => {
    try {
      setLoading(true);
      for (const name of Object.keys(drafts)) {
        await persistDraft(drafts[name]);
      }
      showSuccess('已保存全部修改');
      cancelEdit();
      loadModels();
    } catch (e) {
      showError(e.message);
      setLoading(false);
    }
  };

  // 读改写 options 里的 ModelRatio / CompletionRatio JSON map,只更新本模型的键
  const saveRatioForModel = async (name, modelRatio, completionRatio) => {
    const res = await API.get('/api/option/');
    if (!res.data.success) return;
    const opt = {};
    res.data.data.forEach((it) => { opt[it.key] = it.value; });
    const updateMap = async (key, value) => {
      let m = {};
      try { m = opt[key] ? JSON.parse(opt[key]) : {}; } catch (e) { m = {}; }
      m[name] = value;
      await API.put('/api/option/', { key, value: JSON.stringify(m) });
    };
    await updateMap('ModelRatio', modelRatio);
    await updateMap('CompletionRatio', completionRatio);
  };

  const deleteModel = async (row) => {
    if (!row.in_model_def) {
      showError('该模型尚未登记到模型主表,如需移除请删除其全部渠道来源');
      return;
    }
    if (row.enabled) {
      showError('请先禁用该模型后再删除');
      return;
    }
    try {
      const r = await API.delete(`/api/model_definition/${row.id}`);
      if (!r.data.success) { showError(r.data.message || '删除失败'); return; }
      showSuccess('已删除');
      loadModels();
    } catch (e) { showError(e.message); }
  };

  // 设置某模型启停(不弹提示,供单个/批量复用),返回是否成功
  const setEnabledFor = async (row, enabled) => {
    const body = {
      name: row.name, display_name: row.display_name || '',
      remark: row.remark || '', enabled, model_type: row.model_type || 'chat',
      redirect_to: row.redirect_to || '',
      context_limit: Number(row.context_limit) || 0,
    };
    const r = row.in_model_def
      ? await API.put('/api/model_definition/', { ...body, id: row.id })
      : await API.post('/api/model_definition/', body);
    return r.data.success;
  };

  // 启用/禁用模型(整体)。客户端只下发 enabled 模型。
  const toggleEnabled = async (row) => {
    try {
      const ok = await setEnabledFor(row, !row.enabled);
      if (!ok) { showError('操作失败'); return; }
      showSuccess(!row.enabled ? '已启用' : '已禁用');
      loadModels();
    } catch (e) { showError(e.message); }
  };

  // 批量启用/禁用选中模型
  const batchSetEnabled = async (enabled) => {
    const targets = rows.filter((r) => selectedKeys.includes(r.name));
    if (!targets.length) { showError('请先勾选模型'); return; }
    try {
      setLoading(true);
      for (const row of targets) { await setEnabledFor(row, enabled); }
      showSuccess(enabled ? '已批量启用' : '已批量禁用');
      loadModels();
    } catch (e) { showError(e.message); setLoading(false); }
  };

  // 批量删除选中模型(仅已登记主表的)
  const batchDelete = async () => {
    const chosen = rows.filter((r) => selectedKeys.includes(r.name));
    const registered = chosen.filter((r) => r.in_model_def);
    const skippedUnreg = chosen.filter((r) => !r.in_model_def);
    const targets = registered.filter((r) => !r.enabled);
    const skippedEnabled = registered.filter((r) => r.enabled);
    if (!targets.length) {
      if (skippedEnabled.length) { showError('选中的模型均处于启用状态,请先禁用后再删除'); return; }
      showError('选中的模型均未登记到模型主表,无法删除'); return;
    }
    try {
      setLoading(true);
      for (const row of targets) {
        const r = await API.delete(`/api/model_definition/${row.id}`);
        if (!r.data.success) { showError(`删除 ${row.name} 失败:${r.data.message || ''}`); setLoading(false); return; }
      }
      const notes = [];
      if (skippedEnabled.length) notes.push(`${skippedEnabled.length} 个启用中已跳过`);
      if (skippedUnreg.length) notes.push(`${skippedUnreg.length} 个未登记主表已跳过`);
      showSuccess(notes.length ? `已删除 ${targets.length} 个;${notes.join(';')}` : '已批量删除');
      setSelectedKeys([]);
      loadModels();
    } catch (e) { showError(e.message); setLoading(false); }
  };

  // 单个模型连通性测试(汇总弹窗复用)
  const testModel = async (row) => {
    setTestResults({ models: [{ model: row.name }], loading: true, data: {} });
    try {
      const res = await API.get(`/api/model_definition/test?model=${encodeURIComponent(row.name)}`);
      const { success, message, data } = res.data;
      if (success) setTestResults({ models: [{ model: row.name }], loading: false, data: { [row.name]: data || [] } });
      else { showError(message); setTestResults(null); }
    } catch (e) { showError(e.message); setTestResults(null); }
  };

  // 批量测试选中模型,结果汇总到一个弹窗(按模型分组)
  const batchTest = async () => {
    const targets = rows.filter((r) => selectedKeys.includes(r.name));
    if (!targets.length) { showError('请先勾选模型'); return; }
    setTestResults({ models: targets.map((r) => ({ model: r.name })), loading: true, data: {} });
    const acc = {};
    for (const row of targets) {
      try {
        const res = await API.get(`/api/model_definition/test?model=${encodeURIComponent(row.name)}`);
        acc[row.name] = res.data.success ? (res.data.data || []) : [{ success: false, message: res.data.message || '失败' }];
      } catch (e) {
        acc[row.name] = [{ success: false, message: e.message }];
      }
    }
    setTestResults({ models: targets.map((r) => ({ model: r.name })), loading: false, data: acc });
  };

  // 排序模式:点「排序」进入,期间仅可拖拽、不能做其它操作;拖完点「保存排序」持久化。
  const [sortBackup, setSortBackup] = useState(null);
  const enterSortMode = () => {
    setSortBackup(rows);   // 备份当前顺序,取消时还原
    setSortMode(true);
  };
  const cancelSortMode = () => {
    if (sortBackup) setRows(sortBackup);
    setSortBackup(null);
    setSortMode(false);
    setDragIndex(null);
  };
  const saveSortMode = async () => {
    const ids = rows.filter((r) => r.in_model_def).map((r) => r.id);
    try {
      await API.put('/api/model_definition/reorder', { ids });
      showSuccess('排序已保存');
      setSortBackup(null);
      setSortMode(false);
      loadModels();
    } catch (e) { showError(e.message); }
  };

  // 拖拽:仅排序模式生效,只调整本地 rows 顺序,不立即持久化(保存时统一提交)
  const onDragStart = (index) => { if (sortMode) setDragIndex(index); };
  const onDrop = (index) => {
    if (!sortMode || dragIndex === null || dragIndex === index) { setDragIndex(null); return; }
    const next = [...rows];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setRows(next);
    setDragIndex(null);
  };

  // 新增模型:弹窗录入模型名/显示名/类型 + 可选渠道来源(按模型 id 探测)。
  // form.sourceChannelIds 为选中的渠道 id 列表(可空)。enabled 由 form 决定(复制时默认禁用)。
  const createModel = async (form) => {
    const name = (form.name || '').trim();
    if (!name) { showError('模型名不能为空'); return false; }
    try {
      const res = await API.post('/api/model_definition/', {
        name, display_name: (form.display_name || '').trim(),
        // 新建默认禁用,确认无误后在列表手动启用,避免误下发
        enabled: form.enabled !== undefined ? form.enabled : false,
        model_type: form.model_type || 'chat',
        context_limit: Number(form.context_limit) || 0,
      });
      // 后端错误走 HTTP 200 + success:false,必须显式检查,否则会「假成功」
      if (!res.data.success) {
        showError(res.data.message || '创建失败(模型名可能已存在)');
        return false;
      }
      // 挂选中的渠道来源
      for (const channelId of (form.sourceChannelIds || [])) {
        const sr = await API.post('/api/model_definition/source', { model: name, channel_id: channelId, group: 'default' });
        if (!sr.data.success) { showError(sr.data.message || '挂渠道来源失败'); return false; }
      }
      // 复制场景:带上倍率
      if (form.model_ratio !== undefined || form.completion_ratio !== undefined) {
        await saveRatioForModel(name, Number(form.model_ratio) || 0, Number(form.completion_ratio) || 0);
      }
      showSuccess('已新增模型');
      loadModels();
      return true;
    } catch (e) { showError(e.message); return false; }
  };

  // 按模型 id 查支持它的候选渠道(新增/复制弹窗用)
  const fetchCandidateChannels = async (modelName) => {
    if (!modelName) return [];
    try {
      const res = await API.get(`/api/model_definition/candidate_channels?model=${encodeURIComponent(modelName)}`);
      const { success, data } = res.data;
      if (success) return (data || []).map((ch) => ({ label: `${ch.name} (#${ch.id})`, value: ch.id }));
    } catch (e) { /* 探测失败返回空,不阻塞 */ }
    return [];
  };

  // 所有渠道 models 里出现过的模型名(供新增模型时搜索选择)
  const [channelModelNames, setChannelModelNames] = useState([]);
  const loadChannelModelNames = async () => {
    try {
      const res = await API.get('/api/model_definition/channel_model_names');
      const { success, data } = res.data;
      if (success) setChannelModelNames((data || []).map((n) => ({ label: n, value: n })));
    } catch (e) { /* 不阻塞 */ }
  };
  useEffect(() => { loadChannelModelNames(); }, []);

  // 新增显示入口(别名):只填显示名 + 指向的真实模型,内部 id 自动生成。
  // 后端 redirect_to 非空时会自动把该 id 挂到真实模型渠道 + 写 model_mapping。
  const createAlias = async (form) => {
    const display = (form.display_name || '').trim();
    const target = (form.redirect_to || '').trim();
    if (!display) { showError('显示名不能为空'); return false; }
    if (!target) { showError('请选择指向的真实模型'); return false; }
    // 自动生成内部唯一 id:目标名#显示名 slug,冲突时加序号
    const slug = display.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'alias';
    let id = `${target}#${slug}`;
    const existing = new Set(rows.map((r) => r.name));
    let n = 2;
    while (existing.has(id)) { id = `${target}#${slug}-${n++}`; }
    try {
      const res = await API.post('/api/model_definition/', {
        name: id, display_name: display, enabled: false,
        model_type: form.model_type || 'chat', redirect_to: target,
      });
      if (!res.data.success) { showError(res.data.message || '创建失败'); return false; }
      // 倍率按模型名全局唯一:入口若改了倍率,写到目标真实模型名,所有指向它的入口/真实模型一起生效
      if (form.model_ratio !== undefined || form.completion_ratio !== undefined) {
        await saveRatioForModel(target, Number(form.model_ratio) || 0, Number(form.completion_ratio) || 0);
      }
      showSuccess('已新增显示入口');
      loadModels();
      return true;
    } catch (e) { showError(e.message); return false; }
  };

  return (
    <ModelTable
      loading={loading} rows={rows} rowCandidates={rowCandidates}
      editingSet={editingSet} editing={editing} drafts={drafts} setField={setField}
      selectedKeys={selectedKeys} setSelectedKeys={setSelectedKeys}
      startEdit={startEdit} startEditSelected={startEditSelected} cancelEdit={cancelEdit}
      saveRow={saveRow} saveAll={saveAll}
      deleteModel={deleteModel} testModel={testModel} toggleEnabled={toggleEnabled}
      batchSetEnabled={batchSetEnabled} batchDelete={batchDelete} batchTest={batchTest}
      testResults={testResults} setTestResults={setTestResults} reload={loadModels}
      onDragStart={onDragStart} onDrop={onDrop}
      sortMode={sortMode} enterSortMode={enterSortMode}
      saveSortMode={saveSortMode} cancelSortMode={cancelSortMode}
      createModel={createModel} fetchCandidateChannels={fetchCandidateChannels} createAlias={createAlias}
      channelModelNames={channelModelNames}
    />
  );
};

export default ModelManagement;
