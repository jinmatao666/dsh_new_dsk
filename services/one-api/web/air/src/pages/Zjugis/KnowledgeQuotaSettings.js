import React, { useEffect, useMemo, useState } from 'react';
import { API } from '../../helpers';

export const defaultKnowledgeQuota = { enabled: false, totalBytes: 0, allocations: [] };

const MEGABYTE = 1024 * 1024;

/** @param {unknown} value */
export function normalizeKnowledgeQuota(value) {
  const source = value && typeof value === 'object' ? value : {};
  const allocations = Array.isArray(source.allocations)
    ? source.allocations
      .map(item => ({
        userId: Number(item?.userId) || 0,
        quotaBytes: Number(item?.quotaBytes) || 0,
      }))
      .filter(item => item.userId > 0 && item.quotaBytes > 0)
    : [];
  const seen = new Set();
  const unique = [];
  for (const item of allocations) {
    if (seen.has(item.userId)) continue;
    seen.add(item.userId);
    unique.push(item);
  }
  return {
    enabled: source.enabled === true,
    totalBytes: Math.max(0, Math.floor(Number(source.totalBytes) || 0)),
    allocations: unique,
  };
}

/** @param {number} bytes */
export function bytesToMegabytesInput(bytes) {
  if (!bytes) return '';
  const megabytes = bytes / MEGABYTE;
  return Number.isInteger(megabytes) ? String(megabytes) : String(Math.round(megabytes * 10) / 10);
}

/** @param {string} text */
export function megabytesInputToBytes(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return NaN;
  return Math.round(value * MEGABYTE);
}

function orgChildrenByParent(nodes) {
  const result = new Map();
  for (const node of nodes) {
    const parentId = Number(node.parent_id) || 0;
    result.set(parentId, [...(result.get(parentId) || []), node]);
  }
  for (const list of result.values()) {
    list.sort((left, right) => (Number(left.sort_order) || 0) - (Number(right.sort_order) || 0)
      || Number(left.id) - Number(right.id));
  }
  return result;
}

function personLabel(user) {
  return user.display_name || user.username || `用户 ${user.id}`;
}

/** Dialog that edits total personal storage and per-person allocations against the org tree. */
function KnowledgeQuotaDialog({ value, onClose, onConfirm, disabled }) {
  const [totalInput, setTotalInput] = useState(bytesToMegabytesInput(value.totalBytes));
  const [draftAllocations, setDraftAllocations] = useState(() => new Map(
    (value.allocations || []).map(item => [item.userId, bytesToMegabytesInput(item.quotaBytes)]),
  ));
  const [nodes, setNodes] = useState([]);
  const [users, setUsers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    Promise.all([
      API.get('/api/government-organization/', { signal: controller.signal }),
      API.get('/api/government-organization/memberships', { signal: controller.signal }),
    ]).then(([orgResponse, membersResponse]) => {
      if (!orgResponse.data?.success || !Array.isArray(orgResponse.data.data)) {
        throw new Error(orgResponse.data?.message || '读取组织架构失败');
      }
      if (!membersResponse.data?.success || !Array.isArray(membersResponse.data.data?.memberships)) {
        throw new Error(membersResponse.data?.message || '读取组织成员失败');
      }
      if (disposed) return;
      setNodes(orgResponse.data.data);
      setUsers(Array.isArray(membersResponse.data.data.users) ? membersResponse.data.data.users : []);
      setMemberships(membersResponse.data.data.memberships);
      const roots = orgResponse.data.data.filter(node => !(Number(node.parent_id) > 0));
      if (roots[0]) {
        setSelectedOrgId(Number(roots[0].id));
        setExpanded(new Set([Number(roots[0].id)]));
      }
    }).catch(error => {
      if (!disposed && !controller.signal.aborted) setLoadError(error.message || '读取组织架构失败');
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; controller.abort(); };
  }, []);

  const children = useMemo(() => orgChildrenByParent(nodes), [nodes]);
  const usersById = useMemo(() => {
    const map = new Map();
    for (const user of users) map.set(Number(user.id), user);
    return map;
  }, [users]);
  const membersOfSelected = useMemo(() => {
    if (selectedOrgId == null) return [];
    const ids = new Set(
      memberships.filter(item => Number(item.node_id) === Number(selectedOrgId)).map(item => Number(item.user_id)),
    );
    return [...ids].map(id => usersById.get(id)).filter(Boolean)
      .sort((left, right) => personLabel(left).localeCompare(personLabel(right), 'zh'));
  }, [memberships, selectedOrgId, usersById]);

  const setPersonQuota = (userId, text) => {
    setDraftAllocations(previous => {
      const next = new Map(previous);
      if (!String(text || '').trim()) next.delete(userId);
      else next.set(userId, text);
      return next;
    });
    setLocalError('');
  };

  const confirm = () => {
    const totalBytes = megabytesInputToBytes(totalInput);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      setLocalError('请设置大于 0 的个人知识库总量（单位 MB）');
      return;
    }
    const allocations = [];
    let allocated = 0;
    for (const [userId, text] of draftAllocations.entries()) {
      const quotaBytes = megabytesInputToBytes(text);
      if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
        setLocalError(`请为 ${personLabel(usersById.get(userId) || { id: userId })} 填写有效的容量（MB），或清空该分配`);
        return;
      }
      allocations.push({ userId, quotaBytes });
      allocated += quotaBytes;
      if (allocated > totalBytes) {
        setLocalError('各人员分配容量之和不能超过个人知识库总量');
        return;
      }
    }
    onConfirm(normalizeKnowledgeQuota({ enabled: true, totalBytes, allocations }));
  };

  const renderBranch = (parentId = 0, depth = 0) => (children.get(parentId) || []).map(node => {
    const nodeId = Number(node.id);
    const hasChildren = (children.get(nodeId) || []).length > 0;
    const open = expanded.has(nodeId);
    const active = Number(selectedOrgId) === nodeId;
    return <div key={nodeId}>
      <div className={active ? 'knowledge-quota-org-node active' : 'knowledge-quota-org-node'} style={{ paddingLeft: 8 + depth * 14 }}>
        <button type='button' className='knowledge-quota-org-expand' aria-label={open ? '收起' : '展开'}
          disabled={!hasChildren} onClick={() => setExpanded(current => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
            return next;
          })}>{hasChildren ? (open ? '▾' : '▸') : '·'}</button>
        <button type='button' className='knowledge-quota-org-label' onClick={() => setSelectedOrgId(nodeId)}>
          <span>{node.name}</span>
        </button>
      </div>
      {hasChildren && open ? renderBranch(nodeId, depth + 1) : null}
    </div>;
  });

  return <div className='knowledge-quota-dialog-backdrop' role='presentation' onClick={event => {
    if (event.target === event.currentTarget && !disabled) onClose();
  }}>
    <div className='knowledge-quota-dialog' role='dialog' aria-modal='true' aria-labelledby='knowledge-quota-dialog-title'>
      <header>
        <h3 id='knowledge-quota-dialog-title'>个人知识库容量设置</h3>
        <button type='button' className='settings-secondary' disabled={disabled} onClick={onClose}>关闭</button>
      </header>
      <label className='knowledge-quota-total'>个人知识库总量（MB）
        <input inputMode='decimal' value={totalInput} disabled={disabled}
          placeholder='例如 100' aria-label='个人知识库总量（MB）'
          onChange={event => { setTotalInput(event.target.value); setLocalError(''); }} />
      </label>
      <p className='settings-description'>开启限制后，所有个人知识库已用容量之和不能超过总量。可为具体人员单独分配上限；有分配的人不能超过本人额度，且全体合计仍不能超过总量。</p>
      <div className='knowledge-quota-org-layout'>
        <aside aria-label='组织架构'>
          <p>组织架构</p>
          {loading ? <p role='status'>正在加载组织架构…</p>
            : loadError ? <p role='alert'>{loadError}</p>
              : nodes.length === 0 ? <p>暂无组织节点。请先在用户权限 → 组织架构中创建。</p>
                : <div className='knowledge-quota-org-tree'>{renderBranch()}</div>}
        </aside>
        <section aria-label='人员容量分配'>
          <p>人员分配{selectedOrgId == null ? '' : `（直属 ${membersOfSelected.length} 人）`}</p>
          {selectedOrgId == null ? <p className='settings-description'>请选择左侧组织节点后为成员分配容量。</p>
            : membersOfSelected.length === 0 ? <p className='settings-description'>该节点暂无直属成员。</p>
              : <ul className='knowledge-quota-people'>
                {membersOfSelected.map(user => <li key={user.id}>
                  <span title={user.username}>{personLabel(user)}</span>
                  <label>容量（MB）
                    <input inputMode='decimal' aria-label={`${personLabel(user)} 容量（MB）`}
                      value={draftAllocations.get(Number(user.id)) || ''} disabled={disabled}
                      placeholder='不限制' onChange={event => setPersonQuota(Number(user.id), event.target.value)} />
                  </label>
                </li>)}
              </ul>}
        </section>
      </div>
      {(localError || draftAllocations.size > 0) && <p
        className={localError ? 'knowledge-quota-summary is-error' : 'knowledge-quota-summary'}
        role={localError ? 'alert' : 'status'}
      >
        {localError || `已为 ${draftAllocations.size} 人设置单独容量`}
      </p>}
      <footer>
        <button type='button' className='settings-secondary' disabled={disabled} onClick={onClose}>取消</button>
        <button type='button' className='settings-primary' disabled={disabled || loading || Boolean(loadError)} onClick={confirm}>确定</button>
      </footer>
    </div>
  </div>;
}

/** Knowledge-base tab: storage-limit switch and quota dialog entry. */
export default function KnowledgeQuotaSettings({ value = defaultKnowledgeQuota, onChange, disabled, saving }) {
  const quota = normalizeKnowledgeQuota(value);
  const [dialogOpen, setDialogOpen] = useState(false);
  const summary = !quota.enabled ? '已关闭'
    : quota.totalBytes <= 0 ? '已开启，尚未设置总量'
      : `总量 ${bytesToMegabytesInput(quota.totalBytes)}MB` +
        (quota.allocations.length ? `，已分配 ${quota.allocations.length} 人` : '，未单独分配人员');

  return <div className='knowledge-quota-settings'>
    <table className='settings-features'><thead><tr><th scope='col'>设置项</th><th scope='col'>状态</th></tr></thead><tbody>
      <tr>
        <th scope='row'>文件大小限制</th>
        <td>
          <div className='knowledge-quota-switch-row'>
            <label>
              <input type='checkbox' role='switch' aria-label='文件大小限制'
                checked={quota.enabled} disabled={disabled || saving}
                onChange={event => {
                  const enabled = event.target.checked;
                  onChange(normalizeKnowledgeQuota({ ...quota, enabled }));
                  if (enabled && quota.totalBytes <= 0) setDialogOpen(true);
                }} />
              <span>{quota.enabled ? '开启' : '关闭'}</span>
            </label>
            {quota.enabled && <button type='button' className='settings-secondary knowledge-quota-configure'
              disabled={disabled || saving} onClick={() => setDialogOpen(true)}>设置</button>}
          </div>
        </td>
      </tr>
    </tbody></table>
    <p className='settings-description'>默认关闭。开启后限制全部个人知识库的存储总量，并可在组织架构中为具体人员分配额度。单文件仍不超过 20MB。</p>
    <p className='knowledge-quota-status' role='status'>{summary}</p>
    {dialogOpen && <KnowledgeQuotaDialog
      value={quota}
      disabled={disabled || saving}
      onClose={() => setDialogOpen(false)}
      onConfirm={next => { onChange(normalizeKnowledgeQuota({ ...next, enabled: true })); setDialogOpen(false); }}
    />}
  </div>;
}
