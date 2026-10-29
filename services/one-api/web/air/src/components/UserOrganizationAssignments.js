import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { API } from '../helpers';
import { loadGovernmentOrganizationNodes, organizationPath } from './GovernmentOrganization';

// Only direct affiliations are changed; selecting a parent never assigns all descendants.
export default function UserOrganizationAssignments({ userId, value, onChange, onReady }) {
  const [nodes, setNodes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState({});
  const field = useRef(null);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const children = useMemo(() => {
    const result = new Map();
    nodes.forEach(node => result.set(Number(node.parent_id) || 0, [...(result.get(Number(node.parent_id) || 0) || []), node]));
    return result;
  }, [nodes]);

  useEffect(() => {
    let active = true;
    onReady(false);
    setLoading(true);
    setError('');
    Promise.all([loadGovernmentOrganizationNodes(), API.get('/api/government-organization/memberships')])
      .then(([tree, response]) => {
        if (!response.data?.success || !Array.isArray(response.data.data?.memberships)) {
          throw new Error(response.data?.message || '部门成员接口返回异常，请确认后台已部署组织成员接口');
        }
        if (!active) return;
        setNodes(tree);
        onChange(response.data.data.memberships.filter(item => Number(item.user_id) === Number(userId)).map(item => Number(item.node_id)));
        onReady(true);
      })
      .catch(reason => {
        if (!active) return;
        const status = reason.response?.status;
        setError(status === 401 ? '登录已失效，请重新登录' : status === 403 ? '没有读取组织架构的权限，请联系管理员'
          : reason.response?.data?.message || reason.message || '读取部门归属失败');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, attempt, onChange, onReady]);

  useEffect(() => {
    if (!open) return;
    const close = event => { if (!field.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const renderBranch = (parent, ancestors = new Set()) => (children.get(parent) || []).filter(node => !ancestors.has(node.id)).map(node => {
    const hasChildren = (children.get(node.id) || []).length > 0;
    const next = new Set([...ancestors, node.id]);
    return <li key={node.id}>
      <button type='button' className={`department-tree-row${value.includes(node.id) ? ' is-selected' : ''}`}
        aria-label={hasChildren ? `${expanded[node.id] ? '收起' : '展开'} ${node.name}` : `选择 ${node.name}`}
        aria-expanded={hasChildren ? !!expanded[node.id] : undefined} aria-pressed={!hasChildren ? value.includes(node.id) : undefined}
        onClick={() => {
          if (hasChildren) setExpanded(current => ({ ...current, [node.id]: !current[node.id] }));
          else {
            onChange(value.includes(node.id) ? value.filter(id => id !== node.id) : [...value, node.id]);
            setOpen(false);
          }
        }}>
        <span className='department-branch-icon'>{hasChildren && (expanded[node.id] ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}</span>
        <span>{node.name}</span>
        {value.includes(node.id) && <Check size={16} className='department-selected-icon' aria-hidden='true' />}
      </button>
      {hasChildren && expanded[node.id] && <ul>{renderBranch(node.id, next)}</ul>}
    </li>;
  });

  return <div className='department-field' ref={field} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
    <span className='department-field-label'>部门</span>
    <div className='department-control'>
      <button type='button' className='department-trigger' aria-label='选择部门' aria-haspopup='dialog' aria-expanded={open}
        disabled={loading || !!error} onClick={() => setOpen(current => !current)}>
        <span>{loading ? '正在加载部门…' : value.length ? '继续选择兼任部门' : '请选择所属部门'}</span><ChevronDown size={16} />
      </button>
      {!!value.length && !loading && !error && <div className='department-selections'>
        {value.map(id => <span className='department-chip' key={id}>
          {byId.has(id) ? organizationPath(byId.get(id), byId) : `部门 ${id}`}
          <button type='button' aria-label={`移除部门 ${id}`} onClick={() => onChange(value.filter(item => item !== id))}><X size={13} /></button>
        </span>)}
      </div>}
      {open && !error && <div className='department-dropdown' role='dialog' aria-label='部门层级选择'>
        {nodes.length ? <ul>{renderBranch(0)}</ul> : <span>暂无组织架构，请先创建部门。</span>}
      </div>}
    </div>
    {error && <div className='department-error' role='alert'><span>{error}</span>
      <button type='button' onClick={() => setAttempt(count => count + 1)}>重新加载</button></div>}
  </div>;
}
