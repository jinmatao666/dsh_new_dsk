import React, { useEffect, useState } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import { Cpu, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { API, isRoot, showError, showSuccess } from '../helpers';
import { cacheManagedRole, fetchManagedRoles, removeManagedRole } from '../helpers/roles';
import './RolePermissions.css';
import CustomSelect from './CustomSelect';
import { loadGovernmentOrganizationNodes, OrganizationNodePicker } from './GovernmentOrganization';

const MOCK_MODELS = [
  { name: 'deepseek-chat', display_name: 'DeepSeek Chat', model_type: 'chat' },
  { name: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', model_type: 'chat' },
  { name: 'qwen3.6-plus', display_name: 'Qwen3.6 Plus', model_type: 'chat' },
  { name: 'gpt-4o', display_name: 'GPT-4o', model_type: 'chat' },
  { name: 'claude-3-5-sonnet', display_name: 'Claude 3.5 Sonnet', model_type: 'chat' },
  { name: 'glm-4-flash', display_name: 'GLM-4 Flash', model_type: 'chat' },
];
const ROLE_ICONS = { 1: Users, 100: ShieldCheck };

const toRoleView = (role) => ({ ...role, models: role.permissions?.models || [], organizationNodeIds: role.permissions?.organization_node_ids || [] });

export default function RolePermissions() {
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draftModels, setDraftModels] = useState([]);
  const [organizationNodes, setOrganizationNodes] = useState([]);
  const [draftOrganizationNodeIds, setDraftOrganizationNodeIds] = useState([]);
  const [createModal, setCreateModal] = useState(false);
  const [draft, setDraft] = useState({ role_type: 'member', name: '', description: '', organization_node_ids: [] });
  const [deleting, setDeleting] = useState(null);
  const [mutationError, setMutationError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = React.useRef(false);
  const rootUser = isRoot();
  const canDelete = (role) => !role.is_builtin && role.role > 1 && role.role < 100 && (rootUser || role.role < 10);
  const closeMutation = () => {
    if (pending.current) return;
    setCreateModal(false); setDeleting(null); setMutationError('');
  };

  const editing = roles.find((role) => role.role === editingId) || null;

  useEffect(() => {
    API.get('/api/model_definition/aggregated')
      .then((res) => {
        if (!res.data?.success) throw new Error();
        setModels(res.data.data || []);
      })
      .catch(() => setModels(MOCK_MODELS))
      .finally(() => setLoading(false));

    let cancelled = false;
    fetchManagedRoles()
      .then((data) => {
        if (!cancelled) setRoles(data.map(toRoleView));
      })
      .catch((error) => {
        if (!cancelled) showError(error.message);
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadGovernmentOrganizationNodes().then(setOrganizationNodes).catch(error => showError(error.message));
  }, []);

  const openEditor = (role) => {
    setDraftModels([...role.models]);
    setDraftOrganizationNodeIds([...role.organizationNodeIds]);
    loadGovernmentOrganizationNodes().then(setOrganizationNodes).catch(error => showError(error.message));
    setEditingId(role.role);
  };
  const toggleDraft = (name) => setDraftModels((current) => current.includes(name) ? current.filter((m) => m !== name) : [...current, name]);
  const selectAllModels = () => setDraftModels(current => [...new Set([...current, ...models.map(model => model.name)])]);
  const invertModels = () => setDraftModels(current => {
    // 仅反选列表中的模型，不修改暂未出现在目录中的已有权限。
    const listed = new Set(models.map(model => model.name));
    return [...current.filter(name => !listed.has(name)), ...[...listed].filter(name => !current.includes(name))];
  });
  const saveEditor = async () => {
    if (!editing) return;
    try {
      const res = await API.put(`/api/role/${editing.role}`, {
        name: editing.name,
        description: editing.description,
        status: editing.status,
        permissions: { ...editing.permissions, models: draftModels, organization_node_ids: draftOrganizationNodeIds },
      });
      if (!res.data?.success) throw new Error(res.data?.message || '保存失败');
      cacheManagedRole(res.data.data);
      const updated = toRoleView(res.data.data);
      setRoles((current) => current.map((role) => role.role === updated.role ? updated : role));
      setEditingId(null);
      showSuccess(`「${updated.name}」的配置已更新`);
    } catch (error) {
      showError(error.message || '保存失败');
    }
  };
  const createRole = async (event) => {
    event?.preventDefault();
    const name = draft.name.trim();
    if (!name || pending.current) return;
    pending.current = true; setSubmitting(true); setMutationError('');
    try {
      const res = await API.post('/api/role/', { role_type: draft.role_type, name, description: draft.description.trim(), permissions: { models: [], organization_node_ids: draft.organization_node_ids } });
      if (!res.data?.success) throw new Error(res.data?.message || '新建角色失败');
      cacheManagedRole(res.data.data);
      setRoles((current) => [...current, toRoleView(res.data.data)].sort((a, b) => a.role - b.role));
      setDraft({ role_type: 'member', name: '', description: '', organization_node_ids: [] });
      setCreateModal(false);
      showSuccess('角色已创建');
    } catch (error) {
      setMutationError(error.message || '新建角色失败');
    } finally {
      pending.current = false; setSubmitting(false);
    }
  };
  const deleteRole = async () => {
    if (!deleting || pending.current) return;
    pending.current = true; setSubmitting(true); setMutationError('');
    try {
      const res = await API.delete(`/api/role/${deleting.role}`);
      if (!res.data?.success) throw new Error(res.data?.message || '删除角色失败');
      removeManagedRole(deleting.role);
      setRoles(current => current.filter(role => role.role !== deleting.role));
      setDeleting(null);
      showSuccess('角色已删除');
    } catch (error) {
      setMutationError(error.message || '删除角色失败');
    } finally {
      pending.current = false; setSubmitting(false);
    }
  };

  return (
    <div className='zjugis-role-permissions'>
      <div className='zjugis-role-toolbar'>
        <span className='zjugis-role-toolbar-title'>角色列表</span>
        <button type='button' className='zjugis-role-edit-btn' onClick={() => { setMutationError(''); loadGovernmentOrganizationNodes().then(setOrganizationNodes).catch(error => showError(error.message)); setCreateModal(true); }}>
          <Plus size={13} strokeWidth={2} /> 新建角色
        </button>
      </div>
      <div className='zjugis-role-rows'>
        {rolesLoading && <div className='preview-empty'>正在读取角色…</div>}
        {roles.map((role) => {
          const Icon = ROLE_ICONS[role.role] || Cpu;
          return (
            <div key={role.role} className='zjugis-role-row'>
              <div className='zjugis-role-row-icon'><Icon size={17} strokeWidth={1.8} /></div>
              <div className='zjugis-role-row-info'>
                <strong>{role.name} <small className='role-kind'>{role.role === 100 ? '超级管理员 · 内置' : role.role >= 10 ? '管理员' : '普通成员'}</small></strong>
                <span>{role.description}</span>
                {role.organizationNodeIds.length > 0 && <span className='role-organization-summary'>归属组织：{role.organizationNodeIds.map(id => organizationNodes.find(node => node.id === id)?.name || `节点 ${id}`).join('、')}</span>}
              </div>
              <button type='button' className='zjugis-role-edit-btn' onClick={() => openEditor(role)}>
                <Pencil size={13} strokeWidth={2} /> 配置角色
              </button>
              {canDelete(role) && <button type='button' className='zjugis-role-edit-btn role-delete' aria-label={`删除角色 ${role.name}`}
                onClick={() => { setMutationError(''); setDeleting(role); }}><Trash2 size={13} /> 删除</button>}
            </div>
          );
        })}
        {!rolesLoading && roles.length === 0 && <div className='preview-empty'>暂时无法读取角色，请稍后重试</div>}
      </div>
      {editing && (
        <div className='zjugis-role-modal-mask' onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingId(null); }}>
          <div className='zjugis-role-modal' role='dialog' aria-modal='true'>
            <div className='zjugis-role-modal-head'>
              <div>
                <span>AVAILABLE MODELS</span>
                <h3>配置角色 · {editing.name}</h3>
                <p>{editing.description}</p>
              </div>
              <button type='button' className='zjugis-role-modal-close' onClick={() => setEditingId(null)} aria-label='关闭'>
                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' aria-hidden='true'><path d='M18 6 6 18M6 6l12 12' /></svg>
              </button>
            </div>
            <div className='role-organization-edit'><strong>归属组织</strong><p>可选择多个节点；组织层级由“组织架构”维护。</p>
              <OrganizationNodePicker nodes={organizationNodes} value={draftOrganizationNodeIds} onChange={setDraftOrganizationNodeIds} />
            </div>
            <div className='role-model-bulk-actions' role='group' aria-label='模型批量选择'>
              <button type='button' disabled={loading || models.length === 0} onClick={selectAllModels}>全选</button>
              <span aria-hidden='true'>/</span>
              <button type='button' disabled={loading || models.length === 0} onClick={invertModels}>反选</button>
            </div>
            {loading ? <div style={{ textAlign: 'center', padding: 40 }}>加载中...</div> : (
              <div className='zjugis-model-options'>
                {models.map((model) => {
                  const checked = draftModels.includes(model.name);
                  return (
                    <label key={model.name} className={`zjugis-model-option${checked ? ' checked' : ''}`} onClick={() => toggleDraft(model.name)}>
                      <div className='zjugis-model-option-icon'><Cpu size={15} strokeWidth={1.8} /></div>
                      <div className='zjugis-model-option-info'><strong>{model.display_name || model.name}</strong><span>{model.name}</span></div>
                      <span className='zjugis-model-option-type'>{model.model_type || 'chat'}</span>
                      <div className={`zjugis-model-option-check${checked ? ' active' : ''}`}>{checked && <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12' /></svg>}</div>
                    </label>
                  );
                })}
              </div>
            )}
            <div className='zjugis-role-modal-actions'>
              <button type='button' className='zjugis-modal-btn cancel' onClick={() => setEditingId(null)}>取消</button>
              <button type='button' className='zjugis-modal-btn primary' onClick={saveEditor}>保存</button>
            </div>
          </div>
        </div>
      )}
      <Modal title='新建角色' centered width={480} className='role-management-dialog' visible={createModal} onCancel={closeMutation}
        maskClosable={!submitting} closable={!submitting} closeOnEsc={!submitting} footer={null}>
        <form className='zjugis-role-form' onSubmit={createRole}>
          <label>角色类型<CustomSelect aria-label='角色类型' value={draft.role_type} disabled={submitting} onChange={e => setDraft(current => ({ ...current, role_type: e.target.value }))}>
            <option value='member'>普通成员</option><option value='admin' disabled={!rootUser}>管理员</option>
          </CustomSelect></label>
          <p className='role-form-hint'>{draft.role_type === 'admin' ? '管理员可进入后台管理，请谨慎分配。' : '普通成员用于日常使用，可单独配置可用模型。'}编号由系统分配，超级管理员为内置角色。</p>
          <label>角色名称<input required maxLength={64} disabled={submitting} type='text' value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} placeholder='例如：审核员' /></label>
          <label>角色说明<textarea maxLength={255} disabled={submitting} value={draft.description} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} placeholder='说明该角色的适用范围（可选）' rows={3} /></label>
          <div className='role-organization-edit'><strong>归属组织</strong>
            <OrganizationNodePicker nodes={organizationNodes} value={draft.organization_node_ids} disabled={submitting} onChange={ids => setDraft(current => ({ ...current, organization_node_ids: ids }))} />
          </div>
          {mutationError && <p role='alert' className='role-form-error'>{mutationError}</p>}
          <div className='zjugis-role-modal-actions'>
            <button type='button' className='zjugis-modal-btn cancel' disabled={submitting} onClick={closeMutation}>取消</button>
            <button type='submit' className='zjugis-modal-btn primary' disabled={submitting || !draft.name.trim()}>{submitting ? '正在创建…' : '创建角色'}</button>
          </div>
        </form>
      </Modal>
      <Modal title='删除角色' centered width={440} className='role-management-dialog' visible={Boolean(deleting)} onCancel={closeMutation}
        maskClosable={!submitting} closable={!submitting} closeOnEsc={!submitting} footer={null}>
        <p className='role-delete-message'>确定删除「{deleting?.name}」吗？删除后无法恢复。如有用户仍在使用，请先为其更换角色。</p>
        {mutationError && <p role='alert' className='role-form-error'>{mutationError}</p>}
        <div className='zjugis-role-modal-actions'>
          <button type='button' className='zjugis-modal-btn cancel' disabled={submitting} onClick={closeMutation}>取消</button>
          <button type='button' className='zjugis-modal-btn danger' disabled={submitting} onClick={deleteRole}>{submitting ? '正在删除…' : '确认删除'}</button>
        </div>
      </Modal>
    </div>
  );
}
