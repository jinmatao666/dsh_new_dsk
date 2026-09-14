import React, { useEffect, useState } from 'react';
import { Button, Modal } from '@douyinfe/semi-ui';
import { Cpu, Pencil, Plus, ShieldCheck, Users } from 'lucide-react';
import { API, showError, showSuccess } from '../helpers';
import { cacheManagedRole, fetchManagedRoles } from '../helpers/roles';

const MOCK_MODELS = [
  { name: 'deepseek-chat', display_name: 'DeepSeek Chat', model_type: 'chat' },
  { name: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', model_type: 'chat' },
  { name: 'qwen3.6-plus', display_name: 'Qwen3.6 Plus', model_type: 'chat' },
  { name: 'gpt-4o', display_name: 'GPT-4o', model_type: 'chat' },
  { name: 'claude-3-5-sonnet', display_name: 'Claude 3.5 Sonnet', model_type: 'chat' },
  { name: 'glm-4-flash', display_name: 'GLM-4 Flash', model_type: 'chat' },
];
const ROLE_ICONS = { 1: Users, 100: ShieldCheck };

const toRoleView = (role) => ({ ...role, models: role.permissions?.models || [] });

export default function RolePermissions() {
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draftModels, setDraftModels] = useState([]);
  const [createModal, setCreateModal] = useState(false);
  const [draft, setDraft] = useState({ role: '', name: '', description: '' });

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

  const openEditor = (role) => { setDraftModels([...role.models]); setEditingId(role.role); };
  const toggleDraft = (name) => setDraftModels((current) => current.includes(name) ? current.filter((m) => m !== name) : [...current, name]);
  const saveEditor = async () => {
    if (!editing) return;
    try {
      const res = await API.put(`/api/role/${editing.role}`, {
        name: editing.name,
        description: editing.description,
        status: editing.status,
        permissions: { models: draftModels },
      });
      if (!res.data?.success) throw new Error(res.data?.message || '保存失败');
      cacheManagedRole(res.data.data);
      const updated = toRoleView(res.data.data);
      setRoles((current) => current.map((role) => role.role === updated.role ? updated : role));
      setEditingId(null);
      showSuccess(`「${updated.name}」的可用模型已更新`);
    } catch (error) {
      showError(error.message || '保存失败');
    }
  };
  const createRole = async () => {
    const name = draft.name.trim();
    const roleCode = Number(draft.role);
    if (!name || !Number.isInteger(roleCode) || roleCode <= 0) return;
    try {
      const res = await API.post('/api/role/', { role: roleCode, name, description: draft.description.trim(), permissions: { models: [] } });
      if (!res.data?.success) throw new Error(res.data?.message || '新建角色失败');
      cacheManagedRole(res.data.data);
      setRoles((current) => [...current, toRoleView(res.data.data)].sort((a, b) => a.role - b.role));
      setDraft({ role: '', name: '', description: '' });
      setCreateModal(false);
      showSuccess('角色已创建');
    } catch (error) {
      showError(error.message || '新建角色失败');
    }
  };

  return (
    <div className='zjugis-role-permissions'>
      <div className='zjugis-role-toolbar'>
        <span className='zjugis-role-toolbar-title'>角色列表</span>
        <button type='button' className='zjugis-role-edit-btn' onClick={() => setCreateModal(true)}>
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
                <strong>{role.name}</strong>
                <span>{role.description}</span>
              </div>
              <button type='button' className='zjugis-role-edit-btn' onClick={() => openEditor(role)}>
                <Pencil size={13} strokeWidth={2} /> 可用模型
              </button>
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
                <h3>配置可用模型 · {editing.name}</h3>
                <p>{editing.description}</p>
              </div>
              <button type='button' className='zjugis-role-modal-close' onClick={() => setEditingId(null)} aria-label='关闭'>
                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' aria-hidden='true'><path d='M18 6 6 18M6 6l12 12' /></svg>
              </button>
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
      <Modal title='新建角色' visible={createModal} onCancel={() => setCreateModal(false)} footer={<><Button onClick={() => setCreateModal(false)}>取消</Button><Button theme='solid' type='primary' disabled={!draft.name.trim() || !draft.role} onClick={createRole}>创建角色</Button></>}>
        <div className='zjugis-role-form'>
          <label>角色编号<input type='number' min='1' value={draft.role} onChange={(e) => setDraft((current) => ({ ...current, role: e.target.value }))} placeholder='例如：2' /></label>
          <label>角色名称<input type='text' value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} placeholder='例如：审核员' /></label>
          <label>角色说明<textarea value={draft.description} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} placeholder='说明该角色的适用范围（可选）' rows={3} /></label>
        </div>
      </Modal>
    </div>
  );
}
