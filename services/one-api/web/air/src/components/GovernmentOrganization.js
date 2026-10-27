import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { API, isRoot, showSuccess } from '../helpers';
import './GovernmentOrganization.css';

export const loadGovernmentOrganizationNodes = async () => {
  const response = await API.get('/api/government-organization/');
  if (!response.data?.success || !Array.isArray(response.data.data)) {
    throw new Error(response.data?.message || '读取组织架构失败');
  }
  return response.data.data;
};

export const organizationPath = (node, byId) => {
  const names = [];
  const seen = new Set();
  for (let current = node; current && !seen.has(current.id); current = byId.get(current.parent_id)) {
    seen.add(current.id);
    names.unshift(current.name);
  }
  return names.join(' / ');
};

export function OrganizationNodePicker({ nodes, value, onChange, disabled = false }) {
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const selected = new Set(value);
  return <div className='government-org-picker'>
    {nodes.length === 0 ? <p>尚未创建组织节点，请先到“组织架构”添加。</p> :
      nodes.map(node => <label key={node.id} className='government-org-picker-item'>
        <input type='checkbox' checked={selected.has(node.id)} disabled={disabled}
          onChange={() => onChange(selected.has(node.id) ? value.filter(id => id !== node.id) : [...value, node.id])} />
        <span>{organizationPath(node, byId)}</span>
      </label>)}
  </div>;
}

export default function GovernmentOrganization() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const rootUser = isRoot();

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await loadGovernmentOrganizationNodes();
      setNodes(data);
    } catch (reason) {
      setLoadError(reason.response?.data?.message || reason.message || '读取组织架构失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const children = useMemo(() => {
    const result = new Map();
    for (const node of nodes) result.set(node.parent_id, [...(result.get(node.parent_id) || []), node]);
    return result;
  }, [nodes]);
  const selected = byId.get(selectedId);
  const choose = (node) => { setSelectedId(node.id); setDraft(null); setError(''); };
  const add = (parentId = 0) => {
    setExpanded(current => ({ ...current, [parentId]: true }));
    setDraft({ id: 0, parent_id: parentId, name: '', kind: '', sort_order: 0 });
    setError('');
  };
  const edit = () => {
    if (!selected) return;
    setDraft({ ...selected });
    setError('');
  };
  const save = async (event) => {
    event.preventDefault();
    if (!draft?.name.trim() || saving) return;
    setSaving(true); setError('');
    try {
      const payload = { parent_id: Number(draft.parent_id), name: draft.name.trim(), kind: draft.kind.trim(), sort_order: Number(draft.sort_order) || 0 };
      const response = draft.id ? await API.put(`/api/government-organization/${draft.id}`, payload) : await API.post('/api/government-organization/', payload);
      if (!response.data?.success) throw new Error(response.data?.message || '保存失败');
      await reload();
      setSelectedId(response.data.data.id);
      setDraft(null);
      showSuccess('组织节点已保存');
    } catch (reason) {
      setError(reason.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!selected || saving || !window.confirm(`删除“${selected.name}”？`)) return;
    setSaving(true); setError('');
    try {
      const response = await API.delete(`/api/government-organization/${selected.id}`);
      if (!response.data?.success) throw new Error(response.data?.message || '删除失败');
      setSelectedId(null);
      await reload();
      showSuccess('组织节点已删除');
    } catch (reason) {
      setError(reason.message || '删除失败');
    } finally {
      setSaving(false);
    }
  };
  const renderBranch = (parentId = 0, depth = 0) => (children.get(parentId) || []).map(node => {
    const hasChildren = Boolean(children.get(node.id)?.length);
    const open = expanded[node.id] !== false;
    return <React.Fragment key={node.id}>
      <div className={`government-org-node${selectedId === node.id ? ' selected' : ''}`} style={{ paddingLeft: 12 + depth * 20 }}>
        <button type='button' className='government-org-expand' disabled={!hasChildren}
          aria-label={`${open ? '收起' : '展开'}${node.name}`} onClick={() => setExpanded(current => ({ ...current, [node.id]: !open }))}>
          {hasChildren ? (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span />}
        </button>
        <button type='button' className='government-org-node-label' onClick={() => choose(node)}>
          <FolderTree size={16} /><span>{node.name}</span>{node.kind && <small>{node.kind}</small>}
        </button>
        {rootUser && <button type='button' className='government-org-add-child' aria-label={`在${node.name}下添加节点`} onClick={() => add(node.id)}><Plus size={15} /></button>}
      </div>
      {hasChildren && open && renderBranch(node.id, depth + 1)}
    </React.Fragment>;
  });

  return <div className='government-org'>
    <div className='government-org-heading'>
      <div><h2>组织架构</h2><p>按实际单位逐级创建，层级名称和深度都可自行设定。</p></div>
      {rootUser && <button type='button' className='government-org-primary' disabled={loading || Boolean(loadError)} onClick={() => add()}><Plus size={16} /> 新建顶层组织</button>}
    </div>
    <div className='government-org-columns'>
      <section className='government-org-tree' aria-label='组织架构树'>
        <div className='government-org-section-title'>组织列表 <span>{loading ? '读取中' : loadError ? '未加载' : `${nodes.length} 个节点`}</span></div>
        {loading ? <p className='government-org-empty'>正在读取组织架构…</p> : loadError ? <div className='government-org-load-error' role='alert'><p>读取组织架构失败</p><small>{loadError}</small><button type='button' onClick={() => void reload()}>重新加载</button></div> : nodes.length ? renderBranch() : <p className='government-org-empty'>还没有组织节点。请从顶层组织开始创建。</p>}
      </section>
      <section className='government-org-detail'>
        {loadError || loading ? <p className='government-org-empty'>{loading ? '正在读取组织信息…' : '组织架构尚未加载，请重新加载后查看或创建节点。'}</p> : draft ? <form onSubmit={save} className='government-org-form'>
          <h3>{draft.id ? '编辑组织节点' : '新建组织节点'}</h3>
          <label>节点名称<input required maxLength={120} autoFocus value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder='例如：杭州市规划和自然资源局' /></label>
          <label>节点类型 <small>可选，自定义</small><input maxLength={60} value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value }))} placeholder='例如：政府机构、下属单位、科室' /></label>
          <label>上级组织<select value={draft.parent_id} onChange={event => setDraft(current => ({ ...current, parent_id: Number(event.target.value) }))}>
            <option value={0}>无（顶层组织）</option>
            {nodes.filter(node => node.id !== draft.id).map(node => <option key={node.id} value={node.id}>{organizationPath(node, byId)}</option>)}
          </select></label>
          <label>同级排序<input type='number' value={draft.sort_order} onChange={event => setDraft(current => ({ ...current, sort_order: event.target.value }))} /></label>
          {error && <p role='alert' className='government-org-error'>{error}</p>}
          <div className='government-org-actions'><button type='button' onClick={() => { setDraft(null); setError(''); }}>取消</button><button type='submit' className='government-org-primary' disabled={saving || !draft.name.trim()}>{saving ? '保存中…' : '保存节点'}</button></div>
        </form> : selected ? <>
          <div className='government-org-section-title'>节点详情</div>
          <h3>{selected.name}</h3>
          <dl><dt>类型</dt><dd>{selected.kind || '未设置'}</dd><dt>所属路径</dt><dd>{organizationPath(selected, byId)}</dd><dt>下级节点</dt><dd>{children.get(selected.id)?.length || 0} 个</dd></dl>
          {error && <p role='alert' className='government-org-error'>{error}</p>}
          {rootUser && <div className='government-org-actions'><button type='button' onClick={edit}><Pencil size={15} /> 编辑</button><button type='button' onClick={() => add(selected.id)}><Plus size={15} /> 添加下级</button><button type='button' className='government-org-danger' onClick={remove} disabled={saving}><Trash2 size={15} /> 删除</button></div>}
        </> : <p className='government-org-empty'>选择左侧节点查看详情，或新建顶层组织。</p>}
      </section>
    </div>
  </div>;
}
