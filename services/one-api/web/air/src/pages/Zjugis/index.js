import React, { useEffect, useMemo, useState } from 'react';
import { API } from '../../helpers';

const emptyChannel = {
  name: '',
  type: 1,
  key: '',
  base_url: '',
  models: '',
  groups: 'default',
  other: '',
  openai_organization: '',
  model_mapping: '',
  system_prompt: '',
  auto_ban: 1,
  priority: 0,
  weight: 1,
  test_model: '',
  status: 1,
};
// Keep these numeric values aligned with the legacy OneAPI CHANNEL_OPTIONS.
// In particular, 1 is the native OpenAI type; OpenAI-compatible endpoints are 50.
const channelTypes = [
  [1, 'OpenAI'],
  [50, 'OpenAI 兼容'],
  [49, '阿里云百炼'],
  [17, '阿里通义千问'],
  [16, '智谱 ChatGLM'],
  [14, 'Anthropic Claude'],
  [25, 'Moonshot AI'],
  [15, '百度文心千帆'],
  [18, '讯飞星火认知'],
  [23, '腾讯混元'],
  [24, 'Google Gemini'],
  [36, 'DeepSeek'],
  [44, 'SiliconFlow'],
  [30, 'Ollama'],
  [22, '知识库：FastGPT'],
];
const splitModels = (v) =>
  String(v || '')
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

function useList(path, query = '') {
  const [state, setState] = useState({ rows: [], loading: false, error: '' });
  const refresh = async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await API.get(`${path}${query ? `?${query}` : ''}`);
      if (!res.data?.success) throw new Error(res.data?.message || '请求失败');
      setState({
        rows: Array.isArray(res.data.data) ? res.data.data : [],
        loading: false,
        error: '',
      });
    } catch (e) {
      setState({
        rows: [],
        loading: false,
        error: e?.message || '服务暂不可用',
      });
    }
  };
  useEffect(() => {
    refresh();
  }, [path, query]);
  return { ...state, refresh };
}
function PageHead({ kicker, title, description, action }) {
  return (
    <div className='preview-page-head'>
      <div>
        <div className='preview-kicker'>{kicker}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  return (
    <div
      className='zjugis-modal-backdrop'
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`zjugis-modal${wide ? ' wide' : ''}`}>
        <div className='zjugis-modal-head'>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label='关闭'>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function DialogLayer({ notice, confirm, onCloseNotice, onCloseConfirm }) {
  return (
    <>
      {notice && (
        <Modal title={notice.title || '提示'} onClose={onCloseNotice}>
          <div className='zjugis-dialog-copy'>{notice.message}</div>
          <div className='zjugis-modal-actions'>
            <button type='button' className='preview-button primary' onClick={onCloseNotice}>
              确定
            </button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title || '请确认'} onClose={onCloseConfirm}>
          <div className='zjugis-dialog-copy'>{confirm.message}</div>
          <div className='zjugis-modal-actions'>
            <button type='button' className='preview-button' onClick={onCloseConfirm}>
              取消
            </button>
            <button
              type='button'
              className={`preview-button ${confirm.danger ? 'danger-button' : 'primary'}`}
              onClick={() => {
                const onConfirm = confirm.onConfirm;
                onCloseConfirm();
                onConfirm?.();
              }}
            >
              {confirm.confirmText || '确定'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function useDialog() {
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  return {
    notice: (message, title = '提示') => setNotice({ message, title }),
    confirm: (config) => setConfirm(config),
    node: (
      <DialogLayer
        notice={notice}
        confirm={confirm}
        onCloseNotice={() => setNotice(null)}
        onCloseConfirm={() => setConfirm(null)}
      />
    ),
  };
}
function Field({ label, ...props }) {
  return (
    <label className='zjugis-field'>
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
function SelectField({ label, value, onChange, children }) {
  return (
    <label className='zjugis-field'>
      <span>{label}</span>
      <select value={value ?? ''} onChange={onChange}>
        {children}
      </select>
    </label>
  );
}

export function ModelConfigPage() {
  const dialog = useDialog();
  const list = useList('/api/channel/', 'p=0&page_size=100&id_sort=false');
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('channels');
  const [form, setForm] = useState(emptyChannel);
  const [busy, setBusy] = useState('');
  const [probe, setProbe] = useState(null);
  const [fetchedModels, setFetchedModels] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [modelEdit, setModelEdit] = useState(null);
  const [options, setOptions] = useState({
    PreConsumedQuota: '',
    DefaultContextLimit: '',
    DefaultModel: '',
    VisionModel: '',
  });
  const [testResult, setTestResult] = useState(null);
  const [modelTest, setModelTest] = useState(null);
  const rows = list.rows;
  const models = useMemo(
    () => [...new Set(rows.flatMap((r) => splitModels(r.models)))],
    [rows]
  );
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const open = (row) => {
    setProbe(null);
    setFetchedModels([]);
    setEditing(row || {});
    setForm(
      row
        ? {
            ...emptyChannel,
            ...row,
            models: row.models || '',
            groups: row.group || row.groups || 'default',
          }
        : { ...emptyChannel }
    );
  };
  const save = async (e) => {
    e.preventDefault();
    let mapping = form.model_mapping || '';
    if (mapping.trim()) {
      try {
        mapping = JSON.stringify(JSON.parse(mapping));
      } catch {
        dialog.notice('模型映射必须是合法 JSON');
        return;
      }
    }
    const configuredModels = splitModels(form.models);
    const payload = {
      ...form,
      models: configuredModels.join(','),
      test_model:
        String(form.test_model || '').trim() || configuredModels[0] || '',
      group: form.groups || 'default',
      model_mapping: mapping,
      auto_ban: Number(form.auto_ban) ? 1 : 0,
    };
    delete payload.groups;
    const res = form.id
      ? await API.put('/api/channel/', { ...payload, id: form.id })
      : await API.post('/api/channel/', payload);
    if (res.data?.success) {
      setEditing(null);
      list.refresh();
    } else dialog.notice(res.data?.message || '保存失败');
  };
  const action = async (row, name, value = '', confirmed = false) => {
    if (name === 'delete' && !confirmed) {
      dialog.confirm({
        title: '删除模型渠道',
        message: `确定删除渠道「${row.name}」吗？此操作不可恢复。`,
        confirmText: '确认删除',
        danger: true,
        onConfirm: () => action(row, name, value, true),
      });
      return;
    }
    setBusy(`${name}-${row.id}`);
    try {
      let res;
      let model = '';
      if (name === 'delete') res = await API.delete(`/api/channel/${row.id}/`);
      else if (name === 'copy')
        res = await API.post(`/api/channel/copy/${row.id}`);
      else if (name === 'test') {
        model = value || row.test_model || splitModels(row.models)[0];
        if (!model) throw new Error('请先填写模型列表或测试模型');
        res = await API.get(
          `/api/channel/test/${row.id}?model=${encodeURIComponent(model)}`
        );
      } else if (name === 'enable' || name === 'disable')
        res = await API.put('/api/channel/', {
          id: row.id,
          status: name === 'enable' ? 1 : 2,
        });
      else res = await API.put('/api/channel/', { id: row.id, [name]: value });
      if (!res.data?.success) throw new Error(res.data?.message || '操作失败');
      if (name === 'test')
        setTestResult({ channel: row.name, model, time: res.data.time });
      list.refresh();
    } catch (e) {
      dialog.notice(e.message || '操作失败');
    } finally {
      setBusy('');
    }
  };
  const fetchModels = async () => {
    if (!form.key && !form.id) return dialog.notice('请先填写 API 密钥');
    setBusy('fetch-models');
    try {
      const res =
        form.id && !form.key
          ? await API.get(`/api/channel/${form.id}/fetch_models`)
          : await API.post('/api/channel/fetch_models', {
              type: form.type,
              key: form.key,
              base_url: form.base_url,
            });
      if (!res.data?.success)
        throw new Error(res.data?.message || '获取模型失败');
      const next = [
        ...new Set(
          Array.isArray(res.data.data)
            ? res.data.data
                .map(String)
                .map((x) => x.trim())
                .filter(Boolean)
            : []
        ),
      ];
      if (next.length === 0) throw new Error('上游未返回可选择的模型');
      setFetchedModels(next);
    } catch (e) {
      dialog.notice(e.message || '获取模型失败');
    } finally {
      setBusy('');
    }
  };
  const selectedModels = useMemo(() => splitModels(form.models), [form.models]);
  const toggleFetchedModel = (name) =>
    set(
      'models',
      selectedModels.includes(name)
        ? selectedModels.filter((item) => item !== name).join(',')
        : [...selectedModels, name].join(',')
    );
  const selectFetchedModels = (selectAll) =>
    set(
      'models',
      selectAll
        ? [...new Set([...selectedModels, ...fetchedModels])].join(',')
        : selectedModels
            .filter((name) => !fetchedModels.includes(name))
            .join(',')
    );
  const probeModels = async () => {
    if (!form.id) return dialog.notice('请先保存渠道');
    setBusy('probe');
    try {
      const res = await API.post(`/api/channel/${form.id}/probe_models`, {
        models: splitModels(form.models),
      });
      if (!res.data?.success) throw new Error(res.data?.message || '验证失败');
      setProbe(res.data.data);
    } catch (e) {
      dialog.notice(e.message || '验证失败');
    } finally {
      setBusy('');
    }
  };
  const loadDefinitions = async () => {
    try {
      const res = await API.get('/api/model_definition/aggregated');
      if (res.data?.success) setDefinitions(res.data.data || []);
      else dialog.notice(res.data?.message || '读取模型配置失败');
    } catch (e) {
      dialog.notice(e.message || '读取模型配置失败');
    }
  };
  const loadOptions = async () => {
    try {
      const res = await API.get('/api/option/');
      if (res.data?.success) {
        const next = {};
        (res.data.data || []).forEach((x) => {
          if (
            x.key === 'PreConsumedQuota' ||
            x.key === 'DefaultContextLimit' ||
            x.key === 'DefaultModel' ||
            x.key === 'VisionModel'
          )
            next[x.key] = x.value;
        });
        setOptions(next);
      }
    } catch {}
  };
  useEffect(() => {
    // The basic-settings selector uses the same enabled model definitions.
    // Load them when either management view opens instead of rendering an
    // empty dropdown on a direct visit to “基础设置”.
    if (tab === 'models' || tab === 'basic') loadDefinitions();
    if (tab === 'basic' || tab === 'models') loadOptions();
  }, [tab]);
  const openModel = (row) =>
    setModelEdit(
      row
        ? {
            ...row,
            sourceChannelIds: (row.sources || []).map((x) => x.channel_id),
            model_ratio: row.model_ratio ?? 0,
            completion_ratio: row.completion_ratio ?? 0,
          }
        : {
            name: '',
            display_name: '',
            remark: '',
            enabled: false,
            model_type: 'chat',
            context_limit: 0,
            support_explicit_cache: false,
            modalities: 'text',
            attachment: false,
            sourceChannelIds: [],
            model_ratio: 0,
            completion_ratio: 0,
          }
    );
  // 选中/输入匹配到渠道已有模型名时，自动填显示名、默认上下文、来源渠道
  const syncFromModelName = (name) => {
    if (!name) return;
    setModelEdit((m) => {
      const next = { ...m };
      if (!next.display_name) next.display_name = name;
      const defaultCtx = Number(options.DefaultContextLimit) || 0;
      if (!next.context_limit && defaultCtx) next.context_limit = defaultCtx;
      // 仅新建时自动关联包含该模型的所有渠道；编辑时不覆盖已保存的关联
      if (!next.id) {
        const matched = rows
          .filter((r) => splitModels(r.models).includes(name))
          .map((r) => r.id);
        next.sourceChannelIds = [
          ...new Set([...(next.sourceChannelIds || []), ...matched]),
        ];
      }
      return next;
    });
  };
  const saveModel = async (e) => {
    e.preventDefault();
    const m = modelEdit;
    const supportsImage =
      m.image_input !== undefined
        ? !!m.image_input
        : String(m.modalities || '').split(',').includes('image');
    const body = {
      name: m.name,
      display_name: m.display_name || '',
      remark: m.remark || '',
      enabled: !!m.enabled,
      model_type: m.model_type || 'chat',
      context_limit: Number(m.context_limit) || 0,
      support_explicit_cache: !!m.support_explicit_cache,
      // Desktop reads this server-owned capability during login.  Do not
      // advertise image support just because a provider happens to have some
      // visual models — the administrator enables it per model.
      modalities: supportsImage ? 'text,image' : 'text',
      attachment: supportsImage,
    };
    const res = m.id
      ? await API.put('/api/model_definition/', { ...body, id: m.id })
      : await API.post('/api/model_definition/', body);
    if (!res.data?.success)
      return dialog.notice(res.data?.message || '保存模型失败');
    const oldSources = new Set((m.sources || []).map((x) => x.channel_id));
    const sources = new Set((m.sourceChannelIds || []).map(Number));
    for (const channelId of [...sources].filter((x) => !oldSources.has(x)))
      await API.post('/api/model_definition/source', {
        model: m.name,
        channel_id: channelId,
        group: 'default',
      });
    for (const channelId of [...oldSources].filter((x) => !sources.has(x)))
      await API.delete('/api/model_definition/source', {
        data: { model: m.name, channel_id: channelId, group: 'default' },
      });
    const optRes = await API.get('/api/option/');
    if (optRes.data?.success) {
      const map = {};
      optRes.data.data.forEach((x) => {
        map[x.key] = x.value;
      });
      for (const [key, value] of [
        ['ModelRatio', m.model_ratio],
        ['CompletionRatio', m.completion_ratio],
      ]) {
        let valueMap = {};
        try {
          valueMap = map[key] ? JSON.parse(map[key]) : {};
        } catch {}
        valueMap[m.name] = Number(value) || 0;
        await API.put('/api/option/', { key, value: JSON.stringify(valueMap) });
      }
    }
    setModelEdit(null);
    loadDefinitions();
  };
  const removeModel = async (m) => {
    if (m.enabled) return dialog.notice('请先禁用模型再删除');
    dialog.confirm({
      title: '删除模型定义',
      message: `确定删除模型「${m.name}」吗？此操作不可恢复。`,
      confirmText: '确认删除',
      danger: true,
      onConfirm: () => removeModelConfirmed(m),
    });
  };
  const removeModelConfirmed = async (m) => {
    const res = await API.delete(`/api/model_definition/${m.id}`);
    if (res.data?.success) loadDefinitions();
    else dialog.notice(res.data?.message || '删除失败');
  };
  const toggleModel = async (m) => {
    const body = {
      id: m.id,
      name: m.name,
      display_name: m.display_name || '',
      remark: m.remark || '',
      enabled: !m.enabled,
      model_type: m.model_type || 'chat',
      redirect_to: m.redirect_to || '',
      context_limit: Number(m.context_limit) || 0,
      output_limit: Number(m.output_limit) || 0,
      modalities: m.modalities || 'text',
      reasoning: !!m.reasoning,
      tool_call: m.tool_call !== false,
      attachment: !!m.attachment,
      support_explicit_cache: !!m.support_explicit_cache,
    };
    const res = m.in_model_def
      ? await API.put('/api/model_definition/', body)
      : await API.post('/api/model_definition/', body);
    if (res.data?.success) loadDefinitions();
    else dialog.notice(res.data?.message || '切换状态失败');
  };
  const testModel = async (m) => {
    setModelTest({ model: m.name, status: 'running', results: [] });
    try {
      const res = await API.get(
        `/api/model_definition/test?model=${encodeURIComponent(m.name)}`
      );
      if (!res.data?.success)
        throw new Error(res.data?.message || '模型测试失败');
      const results = Array.isArray(res.data.data) ? res.data.data : [];
      setModelTest({
        model: m.name,
        status:
          results.length > 0 && results.every((result) => result.success)
            ? 'success'
            : 'failed',
        results,
        message:
          results.length > 0
            ? ''
            : '当前模型没有可测试的来源渠道，请先在模型定义中绑定渠道。',
      });
    } catch (e) {
      setModelTest({
        model: m.name,
        status: 'failed',
        results: [],
        message: e.message || '模型测试失败',
      });
    }
  };
  const isVisionModel = (model) =>
    String(model.modalities || '')
      .split(',')
      .map((value) => value.trim())
      .includes('image');
  const testAllModels = async (visionOnly = false) => {
    const enabled = definitions.filter(
      (m) => m.enabled && (!visionOnly || isVisionModel(m))
    );
    if (enabled.length === 0)
      return dialog.notice(visionOnly ? '没有已启用且支持图片输入的模型可测试' : '没有已启用的模型可测试');
    setModelTest({
      model: visionOnly ? '全部视觉模型' : '全部已启用模型',
      status: 'running',
      results: [],
      batch: { current: 0, total: enabled.length },
    });
    const allResults = [];
    for (let index = 0; index < enabled.length; index += 1) {
      const model = enabled[index];
      setModelTest((previous) => ({
        ...previous,
        batch: { current: index + 1, total: enabled.length, name: model.name },
      }));
      try {
        const res = await API.get(
          `/api/model_definition/test?model=${encodeURIComponent(model.name)}`
        );
        if (!res.data?.success) throw new Error(res.data?.message || '模型测试失败');
        const results = Array.isArray(res.data.data) ? res.data.data : [];
        if (results.length === 0) {
          allResults.push({
            model: model.name,
            channel_id: `none-${model.name}`,
            channel_name: '未绑定可测试渠道',
            success: false,
            message: '请先为模型绑定来源渠道。',
          });
        } else {
          allResults.push(...results.map((result) => ({ ...result, model: model.name })));
        }
      } catch (e) {
        allResults.push({
          model: model.name,
          channel_id: `error-${model.name}`,
          channel_name: '请求失败',
          success: false,
          message: e.message || '模型测试失败',
        });
      }
      setModelTest((previous) => ({ ...previous, results: [...allResults] }));
    }
    setModelTest({
      model: visionOnly ? '全部视觉模型' : '全部已启用模型',
      status: allResults.every((result) => result.success) ? 'success' : 'failed',
      results: allResults,
      batch: { current: enabled.length, total: enabled.length },
    });
  };
  const setDefaultModel = async (model) => {
    if (!model.enabled) return dialog.notice('请先启用模型，再设为默认模型');
    try {
      const res = await API.put('/api/option/', { key: 'DefaultModel', value: model.name });
      if (!res.data?.success) throw new Error(res.data?.message || '设置默认模型失败');
      setOptions((current) => ({ ...current, DefaultModel: model.name }));
    } catch (e) {
      dialog.notice(e.message || '设置默认模型失败');
    }
  };
  const saveOptions = async (e) => {
    e.preventDefault();
    const results = await Promise.all(
      Object.entries(options).map(([key, value]) =>
        API.put('/api/option/', { key, value: String(value) })
      )
    );
    if (results.every((r) => r.data?.success)) dialog.notice('基础设置已保存');
    else dialog.notice('部分设置保存失败');
  };
  return (
    <div className='zjugis-new-page'>
      <PageHead
        kicker='MODEL CENTER'
        title='模型配置'
        description='管理渠道、模型和默认调用参数。'
        action={
          <button className='preview-button primary' onClick={() => open()}>
            ＋ 添加模型渠道
          </button>
        }
      />
      <div className='preview-tabs'>
        {[
          ['channels', '渠道配置'],
          ['models', '模型配置'],
          ['basic', '基础设置'],
        ].map(([k, v]) => (
          <button
            key={k}
            className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}
          >
            {v}
          </button>
        ))}
      </div>
      {tab === 'channels' && (
        <>
          <div className='preview-stat-grid'>
            <div>
              <span>已配置渠道</span>
              <strong>{rows.length}</strong>
            </div>
            <div>
              <span>可用模型</span>
              <strong>{models.length}</strong>
            </div>
            <div>
              <span>当前默认模型</span>
              <strong title={options.DefaultModel || ''}>{options.DefaultModel || '—'}</strong>
            </div>
          </div>
          <section className='preview-surface'>
            <div className='preview-section-head'>
              <h2>模型渠道</h2>
              <button className='preview-button' onClick={list.refresh}>
                ↻ 刷新
              </button>
            </div>
            <div className='preview-table-wrap'>
              <table className='preview-table'>
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>类型</th>
                    <th>模型</th>
                    <th>分组</th>
                    <th>优先级/权重</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        <small>{r.base_url || '未设置地址'}</small>
                      </td>
                      <td>
                        {channelTypes.find(
                          (x) => x[0] === Number(r.type)
                        )?.[1] || r.type}
                      </td>
                      <td>
                        {splitModels(r.models).slice(0, 3).join('、') || '—'}
                      </td>
                      <td>{r.group || r.groups || 'default'}</td>
                      <td>
                        {r.priority ?? 0} / {r.weight ?? 1}
                      </td>
                      <td>
                        <span
                          className={r.status === 1 ? 'tag success' : 'tag'}
                        >
                          {r.status === 1 ? '已启用' : '已禁用'}
                        </span>
                      </td>
                      <td>
                        <button className='link-button' onClick={() => open(r)}>
                          编辑
                        </button>
                        <button
                          className='link-button'
                          onClick={() => action(r, 'test')}
                        >
                          测试
                        </button>
                        <button
                          className='link-button'
                          onClick={() =>
                            action(r, r.status === 1 ? 'disable' : 'enable')
                          }
                        >
                          {r.status === 1 ? '停用' : '启用'}
                        </button>
                        <button
                          className='link-button'
                          onClick={() => action(r, 'copy')}
                        >
                          复制
                        </button>
                        <button
                          className='link-button danger'
                          onClick={() => action(r, 'delete')}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.loading && rows.length === 0 && (
                <div className='preview-empty'>暂无渠道，请添加模型渠道</div>
              )}
            </div>
          </section>
        </>
      )}
      {tab === 'models' && (
        <section className='preview-surface'>
          <div className='preview-section-head'>
            <h2>模型定义</h2>
            <div className='form-inline-actions'>
              <button className='preview-button' onClick={loadDefinitions}>
                ↻ 刷新
              </button>
              <button
                className='preview-button'
                disabled={modelTest?.status === 'running' || definitions.length === 0}
                onClick={testAllModels}
              >
                {modelTest?.status === 'running' ? '测试中…' : '全部测试模型'}
              </button>
              <button
                className='preview-button'
                disabled={modelTest?.status === 'running' || !definitions.some((m) => m.enabled && isVisionModel(m))}
                onClick={() => testAllModels(true)}
                title='仅测试已启用且标记为支持图片输入的模型'
              >
                测试视觉模型
              </button>
              <button
                className='preview-button primary'
                onClick={() => openModel()}
              >
                ＋ 添加模型
              </button>
            </div>
          </div>
          <div className='preview-table-wrap'>
            <table className='preview-table'>
              <thead>
                <tr>
                  <th>模型</th>
                  <th>显示名称</th>
                  <th>类型</th>
                  <th>来源渠道</th>
                  <th>倍率</th>
                  <th>上下文</th>
                  <th>状态</th>
                  <th>默认</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <strong>{m.name}</strong>
                      {isVisionModel(m) ? (
                        <span className='tag zjugis-vision-tag'>视觉</span>
                      ) : null}
                      {m.remark ? <small>{m.remark}</small> : null}
                    </td>
                    <td>{m.display_name || m.name || ''}</td>
                    <td>{m.model_type || 'chat'}</td>
                    <td>
                      {(m.sources || [])
                        .map((x) => x.channel_name || `#${x.channel_id}`)
                        .join('、') || ''}
                    </td>
                    <td>
                      {m.model_ratio ?? 0} / {m.completion_ratio ?? 0}
                    </td>
                    <td>{m.context_limit || '默认'}</td>
                    <td>
                      <span className={m.enabled ? 'tag success' : 'tag'}>
                        {m.enabled ? '已启用' : '已禁用'}
                      </span>
                    </td>
                    <td>
                      <label className='zjugis-default-model' title={m.enabled ? '设为桌面端默认模型' : '启用后才可设为默认模型'}>
                        <input
                          type='radio'
                          name='default-model'
                          checked={options.DefaultModel === m.name}
                          disabled={!m.enabled}
                          onChange={() => setDefaultModel(m)}
                        />
                        <span>{options.DefaultModel === m.name ? '默认' : '设为默认'}</span>
                      </label>
                    </td>
                    <td>
                      <button
                        className='link-button'
                        onClick={() => openModel(m)}
                      >
                        编辑
                      </button>
                      <button
                        className='link-button'
                        onClick={() => testModel(m)}
                      >
                        测试
                      </button>
                      <button
                        className='link-button'
                        onClick={() => toggleModel(m)}
                      >
                        {m.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        className='link-button danger'
                        onClick={() => removeModel(m)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {definitions.length === 0 && (
              <div className='preview-empty'>
                暂无模型定义，可从渠道中的模型创建
              </div>
            )}
          </div>
        </section>
      )}
      {tab === 'basic' && (
        <section className='preview-surface'>
          <div className='preview-section-head'>
            <h2>基础设置</h2>
          </div>
          <form className='zjugis-form basic-form' onSubmit={saveOptions}>
            <div className='form-grid'>
              <Field
                label='预扣额度（token）'
                type='number'
                value={options.PreConsumedQuota || ''}
                onChange={(e) =>
                  setOptions({ ...options, PreConsumedQuota: e.target.value })
                }
              />
              <Field
                label='默认上下文限制（token）'
                type='number'
                value={options.DefaultContextLimit || ''}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    DefaultContextLimit: e.target.value,
                  })
                }
              />
              <SelectField
                label='桌面端默认模型'
                value={options.DefaultModel || ''}
                onChange={(e) =>
                  setOptions({ ...options, DefaultModel: e.target.value })
                }
              >
                <option value=''>不指定（按服务端模型列表顺序）</option>
                {definitions
                  .filter((model) => model.enabled)
                  .map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.display_name || model.name}（{model.name}）
                    </option>
                  ))}
              </SelectField>
              <SelectField
                label='默认视觉模型'
                value={options.VisionModel || ''}
                onChange={(e) =>
                  setOptions({ ...options, VisionModel: e.target.value })
                }
              >
                <option value=''>不指定</option>
                {definitions
                  .filter((model) =>
                    model.enabled && String(model.modalities || '').split(',').includes('image')
                  )
                  .map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.display_name || model.name}（{model.name}）
                    </option>
                  ))}
              </SelectField>
            </div>
            <p className='preview-muted'>
              未匹配到具体模型时使用默认上下文限制；默认视觉模型只列出已启用且勾选“支持图片输入”的模型，供桌面端识图工具独立调用；预扣额度会在请求完成后按实际用量多退少补。
            </p>
            <div className='zjugis-modal-actions'>
              <button className='preview-button primary'>保存设置</button>
            </div>
          </form>
        </section>
      )}
      {testResult && (
        <Modal title='渠道测试结果' onClose={() => setTestResult(null)}>
          <div className='channel-test-success'>
            <div className='channel-test-success-icon'>✓</div>
            <div>
              <h3>{testResult.channel} 测试成功</h3>
              <p>
                模型：{testResult.model}
                {testResult.time
                  ? ` · 耗时 ${Number(testResult.time).toFixed(2)} 秒`
                  : ''}
              </p>
            </div>
          </div>
          <div className='zjugis-modal-actions'>
            <button
              className='preview-button primary'
              onClick={() => setTestResult(null)}
            >
              完成
            </button>
          </div>
        </Modal>
      )}
      {modelTest && (
        <Modal title='模型连通性测试' onClose={() => setModelTest(null)}>
          {modelTest.status === 'running' ? (
            <div className='zjugis-test-progress' aria-live='polite'>
              <div className='zjugis-test-spinner' aria-hidden='true' />
              <div>
                <h3>正在测试 {modelTest.model}</h3>
                <p>正在依次连接已绑定的模型渠道，请稍候…</p>
              </div>
              <div className='zjugis-test-progress-track'>
                <span />
              </div>
              {modelTest.batch ? (
                <p className='zjugis-test-live-count'>
                  已完成 {modelTest.results.length} 条结果，正在测试第 {modelTest.batch.current || 1}/{modelTest.batch.total} 个模型
                  {modelTest.batch.name ? `：${modelTest.batch.name}` : ''}
                </p>
              ) : null}
              {modelTest.results.length > 0 ? (
                <div className='zjugis-test-result-list zjugis-test-live-results'>
                  {modelTest.results.map((result) => (
                    <div key={`${result.model || modelTest.model}-${result.channel_id}`}>
                      <span className={result.success ? 'tag success' : 'tag failed'}>
                        {result.success ? '成功' : '失败'}
                      </span>
                      <strong>
                        {result.model ? `${result.model} · ` : ''}
                        {result.channel_name || `渠道 #${result.channel_id}`}
                      </strong>
                      <small>
                        {result.success
                          ? `耗时 ${Number(result.time || 0).toFixed(2)} 秒`
                          : result.message || '连接失败'}
                      </small>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className='zjugis-test-result'>
              <div
                className={`zjugis-test-result-icon ${
                  modelTest.status === 'success' ? 'success' : 'failed'
                }`}
              >
                {modelTest.status === 'success' ? '✓' : '!'}
              </div>
              <div>
                <h3>
                  {modelTest.status === 'success' ? '模型测试成功' : '模型测试未通过'}
                </h3>
                <p>
                  模型：{modelTest.model}
                  {modelTest.batch
                    ? ` · 已完成 ${modelTest.batch.current || 0}/${modelTest.batch.total}`
                    : ''}
                </p>
              </div>
              {modelTest.message && (
                <p className='zjugis-test-message'>{modelTest.message}</p>
              )}
              {modelTest.results.length > 0 && (
                <div className='zjugis-test-result-list'>
                  {modelTest.results.map((result) => (
                    <div key={`${result.model || modelTest.model}-${result.channel_id}`}>
                      <span className={result.success ? 'tag success' : 'tag failed'}>
                        {result.success ? '成功' : '失败'}
                      </span>
                      <strong>
                        {result.model ? `${result.model} · ` : ''}
                        {result.channel_name || `渠道 #${result.channel_id}`}
                      </strong>
                      <small>
                        {result.success
                          ? `耗时 ${Number(result.time || 0).toFixed(2)} 秒`
                          : result.message || '连接失败'}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className='zjugis-modal-actions'>
            <button
              className='preview-button primary'
              disabled={modelTest.status === 'running'}
              onClick={() => setModelTest(null)}
            >
              {modelTest.status === 'running' ? '测试中…' : '完成'}
            </button>
          </div>
        </Modal>
      )}
      {editing !== null && (
        <Modal
          wide
          title={form.id ? '编辑模型渠道' : '添加模型渠道'}
          onClose={() => setEditing(null)}
        >
          <form className='zjugis-form' onSubmit={save}>
            <div className='form-grid'>
              <Field
                label='渠道名称'
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
              <SelectField
                label='渠道类型'
                value={form.type}
                onChange={(e) => set('type', Number(e.target.value))}
              >
                {channelTypes.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectField>
              <Field
                label='代理 / Base URL'
                value={form.base_url || ''}
                onChange={(e) => set('base_url', e.target.value)}
              />
              <Field
                label='API 密钥'
                type='password'
                value={form.key || ''}
                onChange={(e) => set('key', e.target.value)}
                placeholder={form.id ? '留空表示保持原密钥' : ''}
              />
            </div>
            <label className='zjugis-field full'>
              <span>渠道模型</span>
              <div className='form-inline-actions'>
                <button
                  type='button'
                  className='preview-button'
                  onClick={fetchModels}
                  disabled={!!busy}
                >
                  自动获取模型
                </button>
                <button
                  type='button'
                  className='preview-button'
                  onClick={probeModels}
                  disabled={!!busy || !form.id}
                >
                  逐个验证可用性
                </button>
                <button
                  type='button'
                  className='preview-button'
                  onClick={() => set('models', '')}
                >
                  清除模型
                </button>
              </div>
              {fetchedModels.length > 0 ? (
                <div className='zjugis-model-picker'>
                  <div className='zjugis-model-picker-head'>
                    <strong>上游返回 {fetchedModels.length} 个模型</strong>
                    <span>
                      已选择 {selectedModels.filter((name) => fetchedModels.includes(name)).length} 个
                    </span>
                    <button type='button' className='link-button' onClick={() => selectFetchedModels(true)}>全选</button>
                    <button type='button' className='link-button' onClick={() => selectFetchedModels(false)}>取消全选</button>
                  </div>
                  <div className='zjugis-model-options'>
                    {fetchedModels.map((name) => (
                      <label key={name} className='zjugis-model-option'>
                        <input type='checkbox' checked={selectedModels.includes(name)} onChange={() => toggleFetchedModel(name)} />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <small className='preview-muted'>点击“自动获取模型”后，在这里勾选需要向用户提供的模型。</small>
              )}
              <details className='zjugis-manual-models'>
                <summary>手工补充模型（可选）</summary>
                <textarea
                  value={form.models || ''}
                  onChange={(e) => set('models', e.target.value)}
                  rows='3'
                  placeholder='仅在上游不支持模型列表时手工填写，逗号或换行分隔'
                />
              </details>
              {probe && (
                <small className='preview-muted'>
                  验证结果：{probe.ok_count}/{probe.total} 个模型可用
                </small>
              )}
            </label>
            <div className='form-grid'>
              <Field
                label='分组（逗号分隔）'
                value={form.groups || 'default'}
                onChange={(e) => set('groups', e.target.value)}
              />
              <Field
                label='组织 ID'
                value={form.openai_organization || ''}
                onChange={(e) => set('openai_organization', e.target.value)}
              />
              <Field
                label='优先级'
                type='number'
                value={form.priority ?? 0}
                onChange={(e) => set('priority', Number(e.target.value))}
              />
              <Field
                label='权重'
                type='number'
                value={form.weight ?? 1}
                onChange={(e) => set('weight', Number(e.target.value))}
              />
              <Field
                label='测试模型'
                value={form.test_model || ''}
                onChange={(e) => set('test_model', e.target.value)}
              />
              <SelectField
                label='自动禁用'
                value={Number(form.auto_ban) ? 1 : 0}
                onChange={(e) => set('auto_ban', Number(e.target.value))}
              >
                <option value='1'>开启</option>
                <option value='0'>关闭</option>
              </SelectField>
            </div>
            <label className='zjugis-field full'>
              <span>模型映射 JSON</span>
              <textarea
                value={form.model_mapping || ''}
                onChange={(e) => set('model_mapping', e.target.value)}
                rows='3'
                placeholder='{"qwen3.6-plus":"qwen3.6-plus"}'
              />
            </label>
            <label className='zjugis-field full'>
              <span>系统提示词</span>
              <textarea
                value={form.system_prompt || ''}
                onChange={(e) => set('system_prompt', e.target.value)}
                rows='3'
              />
            </label>
            <label className='zjugis-field full'>
              <span>其他参数 JSON</span>
              <textarea
                value={form.other || ''}
                onChange={(e) => set('other', e.target.value)}
                rows='3'
              />
            </label>
            <div className='zjugis-modal-actions'>
              <button
                type='button'
                className='preview-button'
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button className='preview-button primary'>保存渠道</button>
            </div>
          </form>
        </Modal>
      )}
      {modelEdit && (
        <Modal
          wide
          title={modelEdit.id ? '编辑模型定义' : '添加模型定义'}
          onClose={() => setModelEdit(null)}
        >
          <form className='zjugis-form' onSubmit={saveModel}>
            <div className='form-grid zjugis-model-identity-grid'>
              <label className='zjugis-field'>
                <span>模型 ID</span>
                <input
                  list='zjugis-model-id-options'
                  value={modelEdit.name || ''}
                  disabled={!!modelEdit.id}
                  onChange={(e) => {
                    const v = e.target.value;
                    setModelEdit({ ...modelEdit, name: v });
                    if (!modelEdit.id && models.includes(v))
                      syncFromModelName(v);
                  }}
                  required
                />
                {!modelEdit.id && (
                  <small className='preview-muted'>
                    可从渠道已有模型中选择，选中后自动填充显示名称、默认上下文与来源渠道
                  </small>
                )}
                <datalist id='zjugis-model-id-options'>
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <Field
                label='显示名称'
                value={modelEdit.display_name || ''}
                onChange={(e) =>
                  setModelEdit({ ...modelEdit, display_name: e.target.value })
                }
              />
            </div>
            <div className='form-grid'>
              <SelectField
                label='模型类型'
                value={modelEdit.model_type || 'chat'}
                onChange={(e) =>
                  setModelEdit({ ...modelEdit, model_type: e.target.value })
                }
              >
                <option value='chat'>chat</option>
                <option value='image'>image</option>
                <option value='audio'>audio</option>
                <option value='embedding'>embedding</option>
              </SelectField>
              <Field
                label='上下文限制'
                type='number'
                value={modelEdit.context_limit || 0}
                onChange={(e) =>
                  setModelEdit({
                    ...modelEdit,
                    context_limit: Number(e.target.value),
                  })
                }
              />
              <Field
                label='输入倍率'
                type='number'
                value={modelEdit.model_ratio || 0}
                onChange={(e) =>
                  setModelEdit({
                    ...modelEdit,
                    model_ratio: Number(e.target.value),
                  })
                }
              />
              <Field
                label='补全倍率'
                type='number'
                value={modelEdit.completion_ratio || 0}
                onChange={(e) =>
                  setModelEdit({
                    ...modelEdit,
                    completion_ratio: Number(e.target.value),
                  })
                }
              />
            </div>
            <label className='zjugis-field full'>
              <span>备注</span>
              <textarea
                value={modelEdit.remark || ''}
                onChange={(e) =>
                  setModelEdit({ ...modelEdit, remark: e.target.value })
                }
                rows='2'
              />
            </label>
            <label className='zjugis-field full'>
              <span>来源渠道</span>
              <select
                value={String((modelEdit.sourceChannelIds || [])[0] || '')}
                onChange={(e) =>
                  setModelEdit({
                    ...modelEdit,
                    sourceChannelIds: e.target.value ? [Number(e.target.value)] : [],
                  })
                }
              >
                <option value=''>暂不绑定渠道</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}（{r.id}）
                  </option>
                ))}
              </select>
              <small className='preview-muted'>选择该模型实际调用的来源渠道；需要备用渠道时可在后续编辑中调整。</small>
            </label>
            <div className='form-inline-actions'>
              <label className='zjugis-check'>
                <input
                  type='checkbox'
                  checked={!!modelEdit.enabled}
                  onChange={(e) =>
                    setModelEdit({ ...modelEdit, enabled: e.target.checked })
                  }
                />
                启用模型
              </label>
              <label className='zjugis-check'>
                <input
                  type='checkbox'
                  checked={!!modelEdit.support_explicit_cache}
                  onChange={(e) =>
                    setModelEdit({
                      ...modelEdit,
                      support_explicit_cache: e.target.checked,
                    })
                  }
                />
                支持显式缓存
              </label>
              <label className='zjugis-check'>
                <input
                  type='checkbox'
                  checked={
                    modelEdit.image_input !== undefined
                      ? !!modelEdit.image_input
                      : String(modelEdit.modalities || '').split(',').includes('image')
                  }
                  onChange={(e) =>
                    setModelEdit({
                      ...modelEdit,
                      image_input: e.target.checked,
                      modalities: e.target.checked ? 'text,image' : 'text',
                      attachment: e.target.checked,
                    })
                  }
                />
                支持图片输入
              </label>
            </div>
            <small className='preview-muted'>勾选后桌面端可使用识图与图片附件；请仅为上游实际支持视觉的模型启用。</small>
            <div className='zjugis-modal-actions'>
              <button
                type='button'
                className='preview-button'
                onClick={() => setModelEdit(null)}
              >
                取消
              </button>
              <button className='preview-button primary'>保存模型</button>
            </div>
          </form>
        </Modal>
      )}
      {dialog.node}
    </div>
  );
}

export function UsersPage() {
  const dialog = useDialog();
  const [keyword, setKeyword] = useState('');
  const list = useList('/api/user/', 'p=0&size=100&order=');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [edit, setEdit] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [tokens, setTokens] = useState([]);
  const [topup, setTopup] = useState({
    quota: '',
    remark: '',
    expires_in_days: 0,
    admin_password: '',
  });
  const [tokenForm, setTokenForm] = useState({
    name: '',
    remain_quota: 500000,
    unlimited_quota: false,
    expired_time: -1,
  });
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    password: '',
  });
  const shown = list.rows.filter(
    (u) =>
      !keyword ||
      JSON.stringify(u).toLowerCase().includes(keyword.toLowerCase())
  );
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const save = async (e) => {
    e.preventDefault();
    const res = await API.post('/api/user/', form);
    if (res.data?.success) {
      setModal(null);
      setForm({ username: '', display_name: '', password: '' });
      list.refresh();
    } else dialog.notice(res.data?.message || '保存失败');
  };
  const manage = async (u, action, adminPassword = '') => {
    const res = await API.post('/api/user/manage', {
      username: u.username,
      action,
      admin_password: adminPassword,
    });
    if (res.data?.success) list.refresh();
    else dialog.notice(res.data?.message || '操作失败');
  };
  const submitDelete = async (event) => {
    event.preventDefault();
    if (!deleting) return;
    const res = await API.post('/api/user/manage', {
      username: deleting.username,
      action: 'delete',
      admin_password: deletePassword,
    });
    if (res.data?.success) {
      setDeleting(null);
      setDeletePassword('');
      list.refresh();
    } else {
      dialog.notice(res.data?.message || '删除失败，请检查管理员密码');
    }
  };
  const openEdit = async (u) => {
    try {
      const res = await API.get(`/api/user/${u.id}`);
      if (!res.data?.success) throw new Error(res.data?.message);
      setEdit({ ...res.data.data, password: '', admin_password: '' });
    } catch (e) {
      dialog.notice(e.message || '读取用户信息失败');
    }
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    const res = await API.put('/api/user/', {
      id: edit.id,
      username: edit.username,
      display_name: edit.display_name,
      password: edit.password,
      phone: edit.phone,
      group: edit.group,
      admin_password: edit.admin_password,
    });
    if (res.data?.success) {
      setEdit(null);
      list.refresh();
    } else
      dialog.notice(
        res.data?.message || '更新失败；如修改敏感信息，请填写管理员密码'
      );
  };
  const openDetail = async (u) => {
    setDetail(u);
    setTokens([]);
    try {
      const res = await API.get(`/api/admin/token/user/${u.id}`);
      if (res.data?.success) setTokens(res.data.data || []);
    } catch {}
  };
  const manageToken = async (token, action) => {
    const res =
      action === 'delete'
        ? await API.delete(`/api/admin/token/user/${detail.id}/${token.id}`)
        : await API.put(`/api/admin/token/user/${detail.id}?status_only=true`, {
            id: token.id,
            status: action === 'enable' ? 1 : 2,
          });
    if (res.data?.success) openDetail(detail);
    else dialog.notice(res.data?.message || '令牌操作失败');
  };
  const createToken = async (e) => {
    e.preventDefault();
    const res = await API.post(`/api/admin/token/user/${detail.id}`, {
      ...tokenForm,
      remain_quota: Number(tokenForm.remain_quota),
      expired_time:
        tokenForm.expired_time === '' ? -1 : Number(tokenForm.expired_time),
    });
    if (res.data?.success) {
      setTokenForm({
        name: '',
        remain_quota: 500000,
        unlimited_quota: false,
        expired_time: -1,
      });
      openDetail(detail);
    } else dialog.notice(res.data?.message || '创建令牌失败');
  };
  const grant = async (e) => {
    e.preventDefault();
    const perUnit = Number(localStorage.getItem('quota_per_unit') || 1000);
    const res = await API.post('/api/topup', {
      user_id: edit.id,
      quota: Math.round(Number(topup.quota || 0) * perUnit),
      remark: topup.remark,
      expires_in_days: Number(topup.expires_in_days),
      admin_password: topup.admin_password,
    });
    if (res.data?.success) {
      setTopup({
        quota: '',
        remark: '',
        expires_in_days: 0,
        admin_password: '',
      });
      openEdit(edit);
      list.refresh();
    } else dialog.notice(res.data?.message || '积分发放失败');
  };
  return (
    <div className='zjugis-new-page'>
      <PageHead
        kicker='ACCOUNT CENTER'
        title='用户管理'
        description='管理登录账号、权限、额度、令牌和使用状态。'
        action={
          <button
            className='preview-button primary'
            onClick={() => setModal('add')}
          >
            ＋ 添加用户
          </button>
        }
      />
      <div className='preview-stat-grid'>
        <div>
          <span>用户总数</span>
          <strong>{shown.length}</strong>
        </div>
        <div>
          <span>已启用</span>
          <strong>{shown.filter((u) => u.status === 1).length}</strong>
        </div>
        <div>
          <span>累计调用</span>
          <strong>
            {shown.reduce((n, u) => n + (Number(u.request_count) || 0), 0)}
          </strong>
        </div>
      </div>
      <section className='preview-surface'>
        <div className='preview-section-head'>
          <h2>用户列表</h2>
          <div className='form-inline-actions'>
            <input
              className='preview-search'
              placeholder='搜索 ID、用户名、显示名称或邮箱'
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button className='preview-button' onClick={list.refresh}>
              ↻ 刷新
            </button>
          </div>
        </div>
        <div className='preview-table-wrap'>
          <table className='preview-table'>
            <thead>
              <tr>
                <th>ID / 用户</th>
                <th>分组</th>
                <th>账户类型</th>
                <th>角色</th>
                <th>剩余额度</th>
                <th>已用额度</th>
                <th>调用次数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.account_id || `#${u.id}`}</strong>
                    <small>
                      {u.display_name || u.username}
                      {u.email ? ` · ${u.email}` : ''}
                    </small>
                  </td>
                  <td>{u.group || 'default'}</td>
                  <td>{u.account_type === 2 ? '企业' : '个体'}</td>
                  <td>
                    {u.role === 100
                      ? '超级管理员'
                      : u.role === 10
                      ? '管理员'
                      : '普通用户'}
                  </td>
                  <td>
                    {u.subscription_quota !== undefined
                      ? Number(u.subscription_quota) +
                        Number(u.timed_quota_total || 0)
                      : u.quota ?? '—'}
                  </td>
                  <td>{u.used_quota ?? '—'}</td>
                  <td>{u.request_count ?? 0}</td>
                  <td>
                    <span className={u.status === 1 ? 'tag success' : 'tag'}>
                      {u.status === 1
                        ? '已激活'
                        : u.status === 2
                        ? '已封禁'
                        : '未知'}
                    </span>
                  </td>
                  <td>
                    <button
                      className='link-button'
                      onClick={() => openDetail(u)}
                    >
                      详情 / 令牌
                    </button>
                    <button className='link-button' onClick={() => openEdit(u)}>
                      编辑
                    </button>
                    <button
                      className='link-button danger'
                      onClick={() =>
                        manage(u, u.status === 1 ? 'disable' : 'enable')
                      }
                    >
                      {u.status === 1 ? '停用' : '启用'}
                    </button>
                    <button
                      className='link-button danger'
                      onClick={() => {
                        setDeleting(u);
                        setDeletePassword('');
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.loading && shown.length === 0 && (
            <div className='preview-empty'>暂无用户</div>
          )}
        </div>
      </section>
      {modal && (
        <Modal title='添加用户' onClose={() => setModal(null)}>
          <form className='zjugis-form' onSubmit={save}>
            <Field
              label='用户名'
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              required
            />
            <Field
              label='显示名称'
              value={form.display_name}
              onChange={(e) => set('display_name', e.target.value)}
            />
            <Field
              label='密码'
              type='password'
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              required
            />
            <div className='zjugis-modal-actions'>
              <button
                type='button'
                className='preview-button'
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button className='preview-button primary'>创建用户</button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title='确认删除用户' onClose={() => setDeleting(null)}>
          <form className='zjugis-form' onSubmit={submitDelete}>
            <p className='zjugis-danger-copy'>
              将停用并删除用户 <strong>{deleting.display_name || deleting.username}</strong> 的登录入口与 OneAPI 使用权限。该操作需要当前管理员密码确认。
            </p>
            <Field
              label='管理员密码'
              type='password'
              autoFocus
              autoComplete='current-password'
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              required
            />
            <div className='zjugis-modal-actions'>
              <button type='button' className='preview-button' onClick={() => setDeleting(null)}>取消</button>
              <button className='preview-button danger-button'>确认删除</button>
            </div>
          </form>
        </Modal>
      )}
      {edit && (
        <Modal
          wide
          title={`编辑用户 · ${edit.username}`}
          onClose={() => setEdit(null)}
        >
          <form className='zjugis-form' onSubmit={saveEdit}>
            <div className='form-grid'>
              <Field
                label='用户名'
                value={edit.username || ''}
                onChange={(e) => setEdit({ ...edit, username: e.target.value })}
              />
              <Field
                label='显示名称'
                value={edit.display_name || ''}
                onChange={(e) =>
                  setEdit({ ...edit, display_name: e.target.value })
                }
              />
              <Field
                label='新密码（留空不改）'
                type='password'
                value={edit.password || ''}
                onChange={(e) => setEdit({ ...edit, password: e.target.value })}
              />
              <Field
                label='手机号'
                value={edit.phone || ''}
                onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
              />
              <Field
                label='分组'
                value={edit.group || 'default'}
                onChange={(e) => setEdit({ ...edit, group: e.target.value })}
              />
              <Field
                label='管理员密码（修改敏感信息时需要）'
                type='password'
                value={edit.admin_password || ''}
                onChange={(e) =>
                  setEdit({ ...edit, admin_password: e.target.value })
                }
              />
            </div>
            <div className='zjugis-modal-actions'>
              <button
                type='button'
                className='preview-button'
                onClick={() => setEdit(null)}
              >
                取消
              </button>
              <button className='preview-button primary'>保存用户</button>
            </div>
          </form>
          <form className='zjugis-form topup-form' onSubmit={grant}>
            <h3>积分操作</h3>
            <div className='form-grid'>
              <Field
                label='发放积分'
                type='number'
                value={topup.quota}
                onChange={(e) => setTopup({ ...topup, quota: e.target.value })}
              />
              <SelectField
                label='有效期'
                value={topup.expires_in_days}
                onChange={(e) =>
                  setTopup({
                    ...topup,
                    expires_in_days: Number(e.target.value),
                  })
                }
              >
                <option value='0'>永久</option>
                <option value='7'>7 天</option>
                <option value='30'>30 天</option>
                <option value='90'>90 天</option>
              </SelectField>
              <Field
                label='备注'
                value={topup.remark}
                onChange={(e) => setTopup({ ...topup, remark: e.target.value })}
              />
              <Field
                label='管理员密码'
                type='password'
                value={topup.admin_password}
                onChange={(e) =>
                  setTopup({ ...topup, admin_password: e.target.value })
                }
              />
            </div>
            <div className='zjugis-modal-actions'>
              <button className='preview-button'>发放积分</button>
            </div>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal
          wide
          title={`用户详情与令牌 · ${detail.username}`}
          onClose={() => setDetail(null)}
        >
          <div className='detail-grid'>
            {Object.entries(detail)
              .filter(([k]) => !['password', 'key'].includes(k))
              .map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>
                    {typeof v === 'object'
                      ? JSON.stringify(v)
                      : String(v ?? '—')}
                  </strong>
                </div>
              ))}
          </div>
          <div className='token-panel'>
            <div className='preview-section-head'>
              <h3>令牌（{tokens.length}）</h3>
            </div>
            {tokens.map((t) => (
              <div className='token-row' key={t.id}>
                <div>
                  <strong>{t.name}</strong>
                  <small>
                    剩余额度：{t.unlimited_quota ? '无限制' : t.remain_quota} ·{' '}
                    {t.status === 1 ? '已启用' : '已禁用'}
                  </small>
                </div>
                <div>
                  <button
                    className='link-button'
                    onClick={() =>
                      navigator.clipboard?.writeText(`sk-${t.key}`)
                    }
                  >
                    复制
                  </button>
                  <button
                    className='link-button'
                    onClick={() =>
                      manageToken(t, t.status === 1 ? 'disable' : 'enable')
                    }
                  >
                    {t.status === 1 ? '禁用' : '启用'}
                  </button>
                  <button
                    className='link-button danger'
                    onClick={() => manageToken(t, 'delete')}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            <form className='zjugis-form token-form' onSubmit={createToken}>
              <h3>添加令牌</h3>
              <div className='form-grid'>
                <Field
                  label='令牌名称'
                  value={tokenForm.name}
                  onChange={(e) =>
                    setTokenForm({ ...tokenForm, name: e.target.value })
                  }
                  required
                />
                <Field
                  label='令牌额度'
                  type='number'
                  value={tokenForm.remain_quota}
                  disabled={tokenForm.unlimited_quota}
                  onChange={(e) =>
                    setTokenForm({ ...tokenForm, remain_quota: e.target.value })
                  }
                />
                <SelectField
                  label='有效期'
                  value={tokenForm.expired_time}
                  onChange={(e) =>
                    setTokenForm({
                      ...tokenForm,
                      expired_time: Number(e.target.value),
                    })
                  }
                >
                  <option value='-1'>永不过期</option>
                </SelectField>
                <label className='zjugis-check'>
                  <input
                    type='checkbox'
                    checked={tokenForm.unlimited_quota}
                    onChange={(e) =>
                      setTokenForm({
                        ...tokenForm,
                        unlimited_quota: e.target.checked,
                      })
                    }
                  />
                  无限额度
                </label>
              </div>
              <div className='zjugis-modal-actions'>
                <button className='preview-button'>添加令牌</button>
              </div>
            </form>
          </div>
        </Modal>
      )}
      {dialog.node}
    </div>
  );
}

export function LogsPage() {
  const list = useList('/api/log/', 'p=0&page_size=100');
  const prompts = useList('/api/admin/user-prompts', 'p=0&page_size=100');
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState(null);
  const [promptDetail, setPromptDetail] = useState(null);
  const [logTab, setLogTab] = useState('prompts');
  const rows = list.rows.filter(
    (r) =>
      !keyword ||
      JSON.stringify(r).toLowerCase().includes(keyword.toLowerCase())
  );
  const okay = (r) => r.timing_status === 'ok' || r.type === 0 || r.type === 2;
  return (
    <div className='zjugis-new-page'>
      <PageHead
        kicker='MODEL USAGE'
        title='模型日志'
        description='查看用户问答、模型调用、Token 消耗和请求状态。'
        action={
          <button className='preview-button' onClick={() => { list.refresh(); prompts.refresh(); }}>
            ↻ 刷新
          </button>
        }
      />
      <div className='zjugis-log-tabs' role='tablist' aria-label='模型日志分类'>
        <button
          type='button'
          role='tab'
          aria-selected={logTab === 'prompts'}
          className={logTab === 'prompts' ? 'active' : ''}
          onClick={() => setLogTab('prompts')}
        >
          用户提问审计
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={logTab === 'calls'}
          className={logTab === 'calls' ? 'active' : ''}
          onClick={() => setLogTab('calls')}
        >
          调用记录
        </button>
      </div>
      {logTab === 'prompts' && <section className='preview-surface'>
        <div className='preview-section-head'>
          <div>
            <h2>用户提问审计</h2>
            <p className='preview-section-note'>长期保留文本提问与失败原因；不保存图片附件、模型回答或完整上下文。</p>
          </div>
          <span className='tag success'>仅管理员可见</span>
        </div>
        <div className='preview-table-wrap'>
          <table className='preview-table'>
            <thead><tr><th>时间</th><th>用户</th><th>会话 ID</th><th>模型</th><th>问题</th><th>消耗额度</th><th>状态</th><th>详情</th></tr></thead>
            <tbody>
              {prompts.rows.map((record) => (
                <tr key={record.id}>
                  <td>{record.created_at ? new Date(record.created_at * 1000).toLocaleString() : '—'}</td>
                  <td>{record.username || record.user_id || '—'}</td>
                  <td className='zjugis-question-preview'>{record.session_id || '—'}</td>
                  <td>{record.model_name || '—'}</td>
                  <td className='zjugis-question-preview'>{record.question || '—'}</td>
                  <td title='按输入/输出 Token 与模型、渠道倍率计算的 OneAPI 内部消耗单位，不是人民币'>{record.quota ?? 0}</td>
                  <td><span className={record.status === 'success' ? 'tag success' : 'tag'}>{record.status === 'success' ? '成功' : record.status === 'error' ? '失败' : '处理中'}</span></td>
                  <td><button className='link-button' onClick={() => setPromptDetail(record)}>查看</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!prompts.loading && prompts.rows.length === 0 && <div className='preview-empty'>暂无用户提问记录；升级后产生的新请求会自动记录在这里。</div>}
        </div>
      </section>}
      {logTab === 'calls' && <section className='preview-surface'>
        <div className='preview-section-head'>
          <h2>调用记录</h2>
          <input
            className='preview-search'
            placeholder='搜索用户、模型、令牌或请求 ID'
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className='preview-table-wrap'>
          <table className='preview-table'>
            <thead>
              <tr>
                <th>时间</th>
                <th>渠道 / 用户</th>
                <th>令牌</th>
                <th>模型</th>
                <th>提示 / 补全</th>
                <th>缓存读 / 写</th>
                <th>首响应 / 总耗时</th>
                <th>花费</th>
                <th>状态</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.created_at
                      ? new Date(r.created_at * 1000).toLocaleString()
                      : '—'}
                  </td>
                  <td>
                    <strong>{r.channel_name || r.channel_id || '—'}</strong>
                    <small>{r.username || r.user_id || '—'}</small>
                  </td>
                  <td>{r.token_name || '—'}</td>
                  <td>{r.model_name || '—'}</td>
                  <td>
                    {r.prompt_tokens || 0} / {r.completion_tokens || 0}
                  </td>
                  <td>
                    {r.cache_read_tokens || 0} / {r.cache_write_tokens || 0}
                  </td>
                  <td>
                    {r.first_chunk_ms ? `${r.first_chunk_ms} ms` : '—'} /{' '}
                    {r.elapsed_time ? `${r.elapsed_time} ms` : '—'}
                  </td>
                  <td>{r.quota ?? '—'}</td>
                  <td>
                    <span className={okay(r) ? 'tag success' : 'tag'}>
                      {okay(r) ? '成功' : r.timing_status || '异常'}
                    </span>
                  </td>
                  <td>
                    <button
                      className='link-button'
                      onClick={() => setDetail(r)}
                    >
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.loading && rows.length === 0 && (
            <div className='preview-empty'>暂无调用日志</div>
          )}
        </div>
      </section>}
      {detail && (
        <Modal
          wide
          title={`调用详情 · ${detail.request_id || detail.id}`}
          onClose={() => setDetail(null)}
        >
          <div className='detail-grid'>
            {Object.entries(detail).map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>
                  {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
                </strong>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {promptDetail && (
        <Modal wide title={`用户提问 · ${promptDetail.username || promptDetail.user_id || '—'}`} onClose={() => setPromptDetail(null)}>
          <div className='zjugis-prompt-detail'>
            <div><span>问题文本</span><pre>{promptDetail.question || '—'}</pre></div>
            <div><span>失败原因</span><pre>{promptDetail.error_message || '—'}</pre></div>
            <div className='detail-grid'>
              {['session_id', 'model_name', 'request_id', 'channel_id', 'quota', 'prompt_tokens', 'completion_tokens', 'elapsed_time', 'status'].map((key) => (
                <div key={key}><span>{key}</span><strong>{String(promptDetail[key] ?? '—')}</strong></div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function AccountPage() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    API.get('/api/user/self')
      .then((r) => r.data?.success && setUser(r.data.data))
      .catch(() => {});
  }, []);
  const logout = async () => {
    await API.get('/api/user/logout');
    localStorage.removeItem('user');
    window.location.href = '/login';
  };
  return (
    <div className='zjugis-new-page'>
      <PageHead
        kicker='ACCOUNT SETTINGS'
        title='账户设置'
        description='管理当前管理员账户和登录安全设置。'
      />
      <div className='account-grid'>
        <section className='preview-surface account-card'>
          <div className='preview-card-kicker'>PROFILE</div>
          <h2>账户信息</h2>
          <div className='account-row'>
            <span>登录账号</span>
            <strong>{user?.username || '—'}</strong>
          </div>
          <div className='account-row'>
            <span>账户角色</span>
            <strong className='green'>
              {user?.role === 100 ? '超级管理员' : '管理员'}
            </strong>
          </div>
          <div className='account-row'>
            <span>登录状态</span>
            <strong className='green'>已登录</strong>
          </div>
        </section>
        <section className='preview-surface account-card'>
          <div className='preview-card-kicker'>SECURITY</div>
          <h2>安全设置</h2>
          <div className='account-row'>
            <span>会话有效期</span>
            <strong>默认</strong>
          </div>
          <div className='account-row'>
            <span>登录保护</span>
            <strong className='green'>已启用</strong>
          </div>
          <button className='link-button logout-link' onClick={logout}>
            退出登录
          </button>
        </section>
      </div>
    </div>
  );
}
export default ModelConfigPage;
