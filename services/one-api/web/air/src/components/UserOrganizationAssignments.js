import React, { useEffect, useState } from 'react';
import { API } from '../helpers';
import { loadGovernmentOrganizationNodes, OrganizationNodePicker } from './GovernmentOrganization';

export default function UserOrganizationAssignments({ userId }) {
  const [nodes, setNodes] = useState([]);
  const [ids, setIds] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    Promise.all([loadGovernmentOrganizationNodes(), API.get('/api/government-organization/memberships')]).then(([tree, response]) => {
      if (!response.data?.success || !Array.isArray(response.data.data?.memberships)) throw new Error('读取组织归属失败');
      if (active) { setNodes(tree); setIds(response.data.data.memberships.filter(item => item.user_id === userId).map(item => item.node_id)); }
    }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [userId, attempt]);
  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await API.put('/api/government-organization/memberships', { user_id: userId, ids });
      if (!response.data?.success) throw new Error(response.data?.message || '保存组织归属失败');
      setSaved(true);
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  };
  return <section className='user-organization-assignments' aria-label='所属组织'>
    <strong>所属组织</strong><p>可多选，兼任可选择多个组织，也可留空。此处单独保存，无需密码确认。</p>
    {error ? <p role='alert'>{error}<button type='button' disabled={busy} onClick={() => setAttempt(value => value + 1)}>重新加载</button></p> : <OrganizationNodePicker nodes={nodes} value={ids} disabled={busy} onChange={value => { setIds(value); setSaved(false); }} />}
    <div className='government-org-actions'><button type='button' disabled={busy || Boolean(error)} onClick={save}>{busy ? '处理中…' : '保存组织归属'}</button>{saved && <span role='status'>组织归属已保存</span>}</div>
  </section>;
}
