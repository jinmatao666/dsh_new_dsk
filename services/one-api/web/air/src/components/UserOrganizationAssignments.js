import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { API } from '../helpers';
import { loadGovernmentOrganizationNodes, organizationPath } from './GovernmentOrganization';

// 部门归属与组织架构的人员列表共用同一份成员关系。
export default function UserOrganizationAssignments({ userId, value, onChange, onReady }) {
  const [nodes, setNodes] = useState([]);
  const [path, setPath] = useState([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const children = useMemo(() => {
    const result = new Map();
    nodes.forEach(node => result.set(Number(node.parent_id) || 0, [...(result.get(Number(node.parent_id) || 0) || []), node]));
    return result;
  }, [nodes]);

  useEffect(() => {
    let active = true;
    onReady(false);
    setError('');
    Promise.all([loadGovernmentOrganizationNodes(), API.get('/api/government-organization/memberships')])
      .then(([tree, response]) => {
        if (!response.data?.success || !Array.isArray(response.data.data?.memberships)) throw new Error('读取部门归属失败');
        if (!active) return;
        setNodes(tree);
        onChange(response.data.data.memberships.filter(item => Number(item.user_id) === Number(userId)).map(item => Number(item.node_id)));
        onReady(true);
      })
      .catch(reason => { if (active) setError(reason.message || '读取部门归属失败'); });
    return () => { active = false; };
  }, [userId, attempt, onChange, onReady]);

  const add = () => {
    const id = path[path.length - 1];
    if (!id || value.includes(id)) return;
    onChange([...value, id]);
    setPath([]);
  };

  return <div className='department-field'>
    <span className='department-field-label'>部门</span>
    {error ? <p role='alert'>{error} <button type='button' onClick={() => setAttempt(count => count + 1)}>重新加载</button></p> : <>
      <div className='department-selections'>
        {value.map(id => <span className='department-chip' key={id}>
          {byId.has(id) ? organizationPath(byId.get(id), byId) : `部门 ${id}`}
          <button type='button' aria-label={`移除部门 ${id}`} onClick={() => onChange(value.filter(item => item !== id))}><X size={13} /></button>
        </span>)}
      </div>
      <div className='department-path-picker'>
        {Array.from({ length: path.length + 1 }, (_, depth) => {
          const options = children.get(depth ? path[depth - 1] : 0) || [];
          if (!options.length) return null;
          return <label key={depth}>
            <span className='sr-only'>第 {depth + 1} 级部门</span>
            <select aria-label={`第 ${depth + 1} 级部门`} value={path[depth] || ''}
              onChange={event => setPath([...path.slice(0, depth), Number(event.target.value)].filter(Boolean))}>
              <option value=''>请选择</option>
              {options.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select><ChevronDown size={14} aria-hidden='true' />
          </label>;
        })}
        <button type='button' className='department-add' disabled={!path.length || value.includes(path[path.length - 1])} onClick={add}><Plus size={14} />添加部门</button>
      </div>
      {!nodes.length && <small>暂无组织架构，请先创建部门。</small>}
    </>}
  </div>;
}
