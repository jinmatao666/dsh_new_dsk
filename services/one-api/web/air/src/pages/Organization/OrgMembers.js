import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, Upload } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';
import * as XLSX from 'xlsx';
import { API, showError, showSuccess } from '../../helpers';
import { renderQuota } from '../../helpers/render';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Title, Text } = Typography;

// 把表头中文/英文别名映射到内部字段(工号/名称/部门)
const HEADER_ALIASES = {
  employee_no: ['工号', '员工号', '工号编号', 'employee_no', 'employeeno', 'eno', 'no', '编号'],
  name: ['姓名', '名称', '名字', 'name', 'username', '用户名'],
  dept: ['部门', '部门路径', '所属部门', 'dept', 'department', '组织'],
};

function normalizeHeader(h) {
  const key = String(h || '').trim().toLowerCase();
  for (const field of Object.keys(HEADER_ALIASES)) {
    if (HEADER_ALIASES[field].some((a) => a.toLowerCase() === key)) return field;
  }
  return null;
}

// 解析 SheetJS 读出的二维数组:首行表头 → 后续行映射成 {employee_no,name,dept}
function parseSheetRows(aoa) {
  if (!aoa || aoa.length < 2) return [];
  const header = aoa[0].map(normalizeHeader);
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || r.every((c) => c === undefined || String(c).trim() === '')) continue;
    const obj = { employee_no: '', name: '', dept: '' };
    header.forEach((field, idx) => {
      if (field && r[idx] !== undefined) obj[field] = String(r[idx]).trim();
    });
    rows.push(obj);
  }
  return rows;
}

const unitMultipliers = { k: 1000, w: 10000, m: 1000000, b: 1000000000 };
const unitLabels = { k: 'K (千)', w: 'W (万)', m: 'M (百万)', b: 'B (十亿)' };
const unitOptions = Object.keys(unitMultipliers).map((key) => ({ value: key, label: unitLabels[key] }));

// 审计动作 -> 中文展示
const auditActionLabels = {
  dept_create: '新建部门',
  dept_update: '修改部门',
  dept_delete: '删除部门',
  member_set_dept: '调整成员部门',
  member_set_limit: '设置成员限额',
  member_add: '添加成员',
  member_update: '修改成员',
  member_remove: '移除成员',
  quota_topup: '企业充值',
};
const auditActionOptions = Object.keys(auditActionLabels).map((k) => ({ value: k, label: auditActionLabels[k] }));

// 账本来源 -> 中文
const ledgerSourceLabels = {
  topup: '充值',
  admin: '管理员发放',
  refund: '退款',
  migration: '迁移',
  subscription: '订阅',
  monthly_free: '每月赠送',
};
const ledgerSourceLabel = (s) => ledgerSourceLabels[s] || s || '-';

// 由 (expires_at, remaining) 派生行状态:耗尽 > 过期 > 有效
function ledgerRowStatus(row) {
  if (Number(row.remaining) === 0) return 'exhausted';
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'valid';
}
const ledgerStatusMeta = {
  valid: { label: '有效', color: 'green' },
  expired: { label: '已过期', color: 'grey' },
  exhausted: { label: '已耗尽', color: 'orange' },
};

const OrgMembers = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [quotaSummary, setQuotaSummary] = useState({ valid_total: 0, available: 0, used: 0 });
  // 账本页客户端筛选:来源 / 状态 / 到期类型
  const [ledgerSource, setLedgerSource] = useState('');
  const [ledgerStatus, setLedgerStatus] = useState('');
  const [ledgerExpiryType, setLedgerExpiryType] = useState('');
  const [loading, setLoading] = useState(true);
  const [addUsername, setAddUsername] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteMaxUses, setInviteMaxUses] = useState('0');
  const [inviteExpireDays, setInviteExpireDays] = useState('7');
  const [editMember, setEditMember] = useState(null);
  const [editQuotaLimit, setEditQuotaLimit] = useState('');
  const [editQuotaUnit, setEditQuotaUnit] = useState('k');
  const [editUnlimited, setEditUnlimited] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genPrefix, setGenPrefix] = useState('');
  const [genCount, setGenCount] = useState(10);
  const [genPasswordPrefix, setGenPasswordPrefix] = useState('');
  const [genRole, setGenRole] = useState('member');
  const [generating, setGenerating] = useState(false);
  // 批量导入(Excel/CSV → 解析 → 预览 → 提交)
  const [showImport, setShowImport] = useState(false);
  const [importPrefix, setImportPrefix] = useState('');
  const [importPasswordPrefix, setImportPasswordPrefix] = useState('');
  const [importRole, setImportRole] = useState('member');
  const [importRows, setImportRows] = useState([]); // [{employee_no,name,dept}]
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // {success_count,total,results}
  // 批量选择已有用户加入企业(前缀搜索 + 多选)
  const [showSelect, setShowSelect] = useState(false);
  const [selectKeyword, setSelectKeyword] = useState('');
  const [selectResults, setSelectResults] = useState([]);
  const [selectChosen, setSelectChosen] = useState([]); // [{id,username}]
  const [selectRole, setSelectRole] = useState('member');
  const [selectSearching, setSelectSearching] = useState(false);
  const [selectSubmitting, setSelectSubmitting] = useState(false);
  // 部门 + 成员日/月限额
  const [departments, setDepartments] = useState([]);
  const [memberLimits, setMemberLimits] = useState({});
  const [editDept, setEditDept] = useState(null); // {id?, parent_id, name, budget_mode, quota_cap, sort}
  const [limitMember, setLimitMember] = useState(null); // 正在编辑限额的成员
  const [limitDaily, setLimitDaily] = useState('');
  const [limitMonthly, setLimitMonthly] = useState('');
  // 操作审计
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditAction, setAuditAction] = useState('');
  const [auditDetail, setAuditDetail] = useState(null); // 查看详情 JSON
  const [editForm, setEditForm] = useState({ name: '', group: '', max_members: 1, billing_email: '', tax_num: '', discount: 100, login_username: '', new_login_password: '' });
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);

  const loadOrg = async () => {
    const res = await API.get(`/api/organization/${id}`);
    if (res.data.success) {
      const data = res.data.data;
      setOrg(data);
      setEditForm({
        name: data.name || '',
        group: data.group || '',
        max_members: data.max_members || 1,
        billing_email: data.billing_email || '',
        tax_num: data.tax_num || '',
        discount: data.discount || 100,
        login_username: data.login_username || '',
        new_login_password: '',
      });
    }
  };
  const loadMembers = async () => {
    const res = await API.get(`/api/organization/${id}/members?p=0`);
    if (res.data.success) setMembers(res.data.data || []);
  };
  const loadInvitations = async () => {
    const res = await API.get(`/api/organization/${id}/invitations`);
    if (res.data.success) setInvitations(res.data.data || []);
  };
  const loadBreakdown = async () => {
    const res = await API.get(`/api/organization/${id}/quota/breakdown`);
    if (res.data.success) {
      setBreakdown(res.data.data?.items || []);
      const s = res.data.data?.summary;
      if (s) setQuotaSummary({ valid_total: s.valid_total || 0, available: s.available || 0, used: s.used || 0 });
    }
  };
  const loadDepartments = async () => {
    const res = await API.get(`/api/organization/${id}/departments`);
    if (res.data.success) setDepartments(res.data.data || []);
  };
  const loadMemberLimits = async () => {
    const res = await API.get(`/api/organization/${id}/member-limits`);
    if (res.data.success) setMemberLimits(res.data.data || {});
  };
  const loadAuditLogs = async (page = auditPage, action = auditAction) => {
    const res = await API.get(`/api/organization/${id}/audit-logs?page=${page}&page_size=20&action=${action}`);
    if (res.data.success) {
      setAuditLogs(res.data.data?.items || []);
      setAuditTotal(res.data.data?.total || 0);
    }
  };

  useEffect(() => {
    Promise.all([
      loadOrg(), loadMembers(), loadInvitations(), loadBreakdown(),
      loadDepartments(), loadMemberLimits(),
    ]).then(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadAuditLogs(auditPage, auditAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auditPage, auditAction]);

  const handleAddMember = async () => {
    if (!addUsername) { showError('请输入用户名'); return; }
    Modal.confirm({
      title: '确认转入企业',
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>
            添加 <strong>{addUsername}</strong> 为企业成员将触发账户类型切换：
          </div>
          <ul style={{ paddingLeft: 20, margin: 0, color: '#666', fontSize: 13 }}>
            <li>该用户的个人积分（订阅/兑换/月免费/邀请赠送）将全部清零</li>
            <li>该用户的当前活跃订阅将被取消</li>
            <li>转入后所有计费走企业额度，<strong>不可自动恢复</strong></li>
          </ul>
        </div>
      ),
      onOk: async () => {
        const res = await API.post(`/api/organization/${id}/members`, { username: addUsername, role: addRole });
        if (res.data.success) { showSuccess('转入成功，个人积分已清零'); setAddUsername(''); loadMembers(); }
        else showError(res.data.message);
      },
    });
  };

  const handleRemoveMember = async (userId) => {
    Modal.confirm({
      title: '确认移除成员',
      content: (
        <div style={{ color: '#666', fontSize: 13 }}>
          移除该成员后，该用户将恢复为个体账户，但<strong>个人积分不会自动恢复</strong>，需重新发放。
        </div>
      ),
      onOk: async () => {
        const res = await API.delete(`/api/organization/${id}/members/${userId}`);
        if (res.data.success) { showSuccess('已转出为个体账户'); loadMembers(); }
        else showError(res.data.message);
      },
    });
  };

  const handleUpdateQuota = async () => {
    if (!editMember) return;
    const quotaValue = editUnlimited ? -1 : Number(editQuotaLimit) * (unitMultipliers[editQuotaUnit] || 1000);
    const res = await API.put(`/api/organization/${id}/members/${editMember.user_id}`, {
      quota_limit: quotaValue,
    });
    if (res.data.success) { showSuccess('更新成功'); setEditMember(null); loadMembers(); }
    else showError(res.data.message);
  };

  // ---- 部门 ----
  const openCreateDept = (parentId = 0) => setEditDept({ parent_id: parentId, name: '', budget_mode: 'shared', quota_cap: -1, sort: 0 });
  const openEditDept = (d) => setEditDept({ id: d.id, parent_id: d.parent_id, name: d.name, budget_mode: d.budget_mode, quota_cap: d.quota_cap, sort: d.sort, status: d.status });

  const handleSaveDept = async () => {
    if (!editDept?.name?.trim()) { showError('请输入部门名称'); return; }
    const payload = {
      parent_id: editDept.parent_id || 0,
      name: editDept.name.trim(),
      budget_mode: editDept.budget_mode || 'shared',
      quota_cap: editDept.quota_cap === '' || editDept.quota_cap === null ? -1 : Number(editDept.quota_cap),
      sort: Number(editDept.sort) || 0,
      status: editDept.status || 1,
    };
    const res = editDept.id
      ? await API.put(`/api/organization/${id}/departments/${editDept.id}`, payload)
      : await API.post(`/api/organization/${id}/departments`, payload);
    if (res.data.success) { showSuccess('已保存'); setEditDept(null); loadDepartments(); }
    else showError(res.data.message);
  };

  const handleDeleteDept = async (deptId) => {
    Modal.confirm({
      title: '确认删除部门',
      content: '若该部门下仍有子部门或成员，将无法删除。',
      onOk: async () => {
        const res = await API.delete(`/api/organization/${id}/departments/${deptId}`);
        if (res.data.success) { showSuccess('已删除'); loadDepartments(); }
        else showError(res.data.message);
      },
    });
  };

  const handleSetMemberDept = async (userId, deptId) => {
    const res = await API.put(`/api/organization/${id}/members/${userId}/dept`, { dept_id: deptId || 0 });
    if (res.data.success) { showSuccess('已调整部门'); loadMembers(); }
    else showError(res.data.message);
  };

  // ---- 成员日/月限额 ----
  const openLimitModal = (member) => {
    const lim = memberLimits[member.user_id];
    setLimitMember(member);
    setLimitDaily(lim && lim.daily_cap >= 0 ? String(lim.daily_cap) : '');
    setLimitMonthly(lim && lim.monthly_cap >= 0 ? String(lim.monthly_cap) : '');
  };

  const handleSaveLimit = async () => {
    if (!limitMember) return;
    const dailyCap = limitDaily === '' ? -1 : Number(limitDaily);
    const monthlyCap = limitMonthly === '' ? -1 : Number(limitMonthly);
    const res = await API.put(`/api/organization/${id}/members/${limitMember.user_id}/limit`, {
      daily_cap: dailyCap, monthly_cap: monthlyCap,
    });
    if (res.data.success) { showSuccess('限额已保存'); setLimitMember(null); loadMemberLimits(); }
    else showError(res.data.message);
  };

  const deptName = (deptId) => {
    const d = departments.find((x) => x.id === deptId);
    return d ? d.name : '未分配';
  };

  const handleCreateInvitation = async () => {
    const res = await API.post(`/api/organization/${id}/invitation`, {
      role: inviteRole, max_uses: Number(inviteMaxUses), expire_days: Number(inviteExpireDays),
    });
    if (res.data.success) { showSuccess('邀请码已生成'); setShowInviteModal(false); loadInvitations(); }
    else showError(res.data.message);
  };

  const handleDeleteInvitation = async (code) => {
    const res = await API.delete(`/api/organization/${id}/invitation/${code}`);
    if (res.data.success) { showSuccess('已删除'); loadInvitations(); }
    else showError(res.data.message);
  };

  const handleBatchGenerate = async () => {
    if (!genPrefix) { showError('请输入账号前缀'); return; }
    if (genCount <= 0 || genCount > 500) { showError('生成数量需在1-500之间'); return; }
    setGenerating(true);
    try {
      const res = await API.post(`/api/organization/${id}/members/generate`, {
        prefix: genPrefix,
        count: genCount,
        password_prefix: genPasswordPrefix,
        role: genRole,
      });
      if (res.data.success) {
        const { success_count, total, failed_users } = res.data.data;
        if (failed_users && failed_users.length > 0) {
          showSuccess(`成功 ${success_count}/${total}，失败: ${failed_users.join(', ')}`);
        } else {
          showSuccess(`成功生成 ${success_count} 个账号`);
        }
        setShowGenerate(false);
        loadMembers();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('请求失败');
    }
    setGenerating(false);
  };

  // 读取并解析上传的 Excel/CSV 文件 → importRows
  const handleImportFile = (file) => {
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        const rows = parseSheetRows(aoa);
        if (rows.length === 0) {
          showError('未解析到有效数据，请检查表头(工号/姓名/部门)与内容');
          return;
        }
        setImportRows(rows);
        setImportFileName(file.name);
        showSuccess(`已解析 ${rows.length} 行`);
      } catch (e) {
        showError('文件解析失败: ' + e.message);
      }
    };
    reader.readAsArrayBuffer(file.fileInstance || file);
    return false; // 阻止 semi Upload 自动上传
  };

  const handleSubmitImport = async () => {
    if (!importPrefix) { showError('请输入账号前缀'); return; }
    if (importRows.length === 0) { showError('请先上传并解析文件'); return; }
    setImporting(true);
    try {
      const res = await API.post(`/api/organization/${id}/members/import`, {
        prefix: importPrefix,
        password_prefix: importPasswordPrefix,
        role: importRole,
        rows: importRows,
      });
      if (res.data.success) {
        const data = res.data.data;
        setImportResult(data);
        showSuccess(`导入完成：成功 ${data.success_count}/${data.total}`);
        loadMembers();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('请求失败');
    }
    setImporting(false);
  };

  // 前缀搜索全平台用户(平台管理员权限)
  const handleSearchUsers = async () => {
    const kw = selectKeyword.trim();
    if (!kw) { showError('请输入用户名/邮箱前缀'); return; }
    setSelectSearching(true);
    try {
      const res = await API.get(`/api/user/search?keyword=${encodeURIComponent(kw)}`);
      if (res.data.success) {
        setSelectResults(res.data.data || []);
        if ((res.data.data || []).length === 0) showError('未搜索到用户');
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('搜索失败');
    }
    setSelectSearching(false);
  };

  const toggleChosen = (u) => {
    setSelectChosen((prev) => prev.some((x) => x.id === u.id)
      ? prev.filter((x) => x.id !== u.id)
      : [...prev, { id: u.id, username: u.username }]);
  };

  const handleSubmitSelect = async () => {
    if (selectChosen.length === 0) { showError('请至少选择一个用户'); return; }
    setSelectSubmitting(true);
    try {
      const res = await API.post(`/api/organization/${id}/members/batch`, {
        user_ids: selectChosen.map((x) => x.id),
        role: selectRole,
      });
      if (res.data.success) {
        const d = res.data.data;
        showSuccess(`已加入：成功 ${d.success_count}/${d.total}`);
        setShowSelect(false);
        setSelectChosen([]);
        setSelectResults([]);
        setSelectKeyword('');
        loadMembers();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('请求失败');
    }
    setSelectSubmitting(false);
  };

  const handleEditSubmit = () => {
    setShowEditPassword(true);
  };

  const handleEditConfirm = async () => {
    if (!editPassword) {
      showError('请输入管理员密码');
      return;
    }
    const res = await API.put(`/api/organization/${id}`, { ...editForm, password: editPassword });
    if (res.data.success) {
      showSuccess('修改成功');
      setShowEditPassword(false);
      setEditPassword('');
      loadOrg();
    } else {
      showError(res.data.message);
    }
  };

  const renderCap = (cap) => (cap === undefined || cap < 0 ? '不限' : cap === 0 ? <Tag color="red">禁用</Tag> : renderQuota(cap));
  const memberColumns = [
    { title: '用户ID', dataIndex: 'user_id' },
    { title: '角色', dataIndex: 'role', render: (v) => <Tag color={v === 'owner' ? 'orange' : v === 'admin' ? 'blue' : 'grey'}>{v === 'owner' ? '所有者' : v === 'admin' ? '管理员' : '成员'}</Tag> },
    { title: '部门', dataIndex: 'dept_id', render: (v, record) => (
      <Select
        size="small"
        value={v || 0}
        style={{ width: 130 }}
        onChange={(val) => handleSetMemberDept(record.user_id, val)}
        optionList={[{ value: 0, label: '未分配' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
      />
    )},
    { title: '额度上限', dataIndex: 'quota_limit', render: (v) => v === -1 ? '不限' : renderQuota(v) },
    { title: '日限额', key: 'daily_limit', render: (text, record) => renderCap(memberLimits[record.user_id]?.daily_cap) },
    { title: '月限额', key: 'monthly_limit', render: (text, record) => renderCap(memberLimits[record.user_id]?.monthly_cap) },
    { title: '当日/当月已用', key: 'period_used', render: (text, record) => {
      const lim = memberLimits[record.user_id];
      if (!lim) return <Text type="tertiary">-</Text>;
      return <Text type="tertiary">{renderQuota(lim.daily_used || 0)} / {renderQuota(lim.monthly_used || 0)}</Text>;
    }},
    { title: '已用额度', dataIndex: 'used_quota', render: (v) => renderQuota(v) },
    { title: '操作', render: (text, record) => (
      <Space>
        <Button size="small" onClick={() => { setEditMember(record); setEditUnlimited(record.quota_limit === -1); setEditQuotaLimit(record.quota_limit === -1 ? '' : ''); setEditQuotaUnit('k'); }}>额度</Button>
        <Button size="small" onClick={() => openLimitModal(record)}>日/月限</Button>
        {record.role !== 'owner' && <Button size="small" type="danger" onClick={() => handleRemoveMember(record.user_id)}>移除</Button>}
      </Space>
    )},
  ];

  const inviteColumns = [
    { title: '邀请码', dataIndex: 'invite_code', render: (v) => <code>{v}</code> },
    { title: '角色', dataIndex: 'role' },
    { title: '使用次数', key: 'used_uses', render: (text, r) => `${r.used_count}/${r.max_uses === 0 ? '∞' : r.max_uses}` },
    { title: '过期时间', dataIndex: 'expired_at', render: (v) => v ? new Date(v).toLocaleDateString() : '永不' },
    { title: '操作', render: (text, r) => <Button size="small" type="danger" onClick={() => handleDeleteInvitation(r.invite_code)}>删除</Button> },
  ];

  const auditColumns = [
    { title: '时间', dataIndex: 'created_at', width: 170, render: (v) => v ? new Date(v).toLocaleString() : '-' },
    { title: '操作者', dataIndex: 'actor_name', width: 120, render: (v, r) => v || (r.actor_id === 0 ? '系统' : `#${r.actor_id}`) },
    { title: '动作', dataIndex: 'action', width: 130, render: (v) => <Tag>{auditActionLabels[v] || v}</Tag> },
    { title: '目标', key: 'target', width: 110, render: (text, r) => r.target_id ? `${r.target_type}#${r.target_id}` : (r.target_type || '-') },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v) => v || '-' },
    {
      title: '详情', render: (text, r) => r.detail
        ? <Button size="small" theme="borderless" onClick={() => setAuditDetail(r)}>查看</Button>
        : <Text type="tertiary">-</Text>,
    },
  ];

  const { visibleColumns: memberVisibleColumns, columnConfigButton: memberColumnConfigButton } = useColumnConfig({
    storageKey: 'orgmembers_member_table_visible_columns',
    columnMeta: [
      { key: 'user_id', label: '用户ID', always: true },
      { key: 'role', label: '角色' },
      { key: 'dept_id', label: '部门' },
      { key: 'quota_limit', label: '额度上限' },
      { key: 'daily_limit', label: '日限额' },
      { key: 'monthly_limit', label: '月限额' },
      { key: 'period_used', label: '当日/当月已用' },
      { key: 'used_quota', label: '已用额度' },
    ],
    allColumns: memberColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: inviteVisibleColumns, columnConfigButton: inviteColumnConfigButton } = useColumnConfig({
    storageKey: 'orgmembers_invite_table_visible_columns',
    columnMeta: [
      { key: 'invite_code', label: '邀请码', always: true },
      { key: 'role', label: '角色' },
      { key: 'used_uses', label: '使用次数' },
      { key: 'expired_at', label: '过期时间' },
    ],
    allColumns: inviteColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const { visibleColumns: auditVisibleColumns, columnConfigButton: auditColumnConfigButton } = useColumnConfig({
    storageKey: 'orgmembers_audit_table_visible_columns',
    columnMeta: [
      { key: 'created_at', label: '时间', always: true },
      { key: 'actor_name', label: '操作者' },
      { key: 'action', label: '动作' },
      { key: 'target', label: '目标' },
      { key: 'ip', label: 'IP' },
    ],
    allColumns: auditColumns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<IconArrowLeft />} onClick={() => navigate('/organization')}>返回</Button>
          <Title heading={4} style={{ margin: 0 }}>{org?.name || '企业设置'}</Title>
        </Space>
        {org && (
          <Text type="tertiary">编码: {org.code} | 分组: {org.group} | 有效总额: {renderQuota(quotaSummary.valid_total)} | 可用: {renderQuota(quotaSummary.available)} | 已用: {renderQuota(quotaSummary.used)}</Text>
        )}
      </Space>

      <ConfigPageTabs defaultActiveKey="basic" sticky={false} style={{ marginBottom: 16 }}>
        <ConfigPageTabPane tab="基础信息" itemKey="basic">
          <Card title="基础信息">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 16, maxWidth: 880 }}>
              <div>
                <label>企业名称</label>
                <Input value={editForm.name} onChange={(v) => setEditForm({ ...editForm, name: v })} />
              </div>
              <div>
                <label>分组</label>
                <Input value={editForm.group} onChange={(v) => setEditForm({ ...editForm, group: v })} />
              </div>
              <div>
                <label>成员上限</label>
                <InputNumber value={editForm.max_members} onChange={(v) => setEditForm({ ...editForm, max_members: v })} min={1} style={{ width: '100%' }} />
              </div>
              <div>
                <label>充值折扣率（1-100，100=原价，90=9折）</label>
                <InputNumber value={editForm.discount} onChange={(v) => setEditForm({ ...editForm, discount: v })} min={1} max={100} style={{ width: '100%' }} />
              </div>
              <div>
                <label>财务邮箱</label>
                <Input value={editForm.billing_email} onChange={(v) => setEditForm({ ...editForm, billing_email: v })} />
              </div>
              <div>
                <label>税号</label>
                <Input value={editForm.tax_num} onChange={(v) => setEditForm({ ...editForm, tax_num: v })} />
              </div>
              <div>
                <label>登录用户名（3001 企业后台）</label>
                <Input value={editForm.login_username} onChange={(v) => setEditForm({ ...editForm, login_username: v })} placeholder="企业登录用户名" />
              </div>
              <div>
                <label>重置登录密码（留空则不修改）</label>
                <Input mode="password" value={editForm.new_login_password} onChange={(v) => setEditForm({ ...editForm, new_login_password: v })} placeholder="留空表示不修改密码" />
              </div>
            </div>
            <Space style={{ marginTop: 20 }}>
              <Button theme="solid" type="primary" onClick={handleEditSubmit}>保存</Button>
            </Space>
          </Card>
        </ConfigPageTabPane>

        <ConfigPageTabPane tab="成员设置" itemKey="members">
          <Card style={{ marginBottom: 16 }}>
            <Title heading={4}>{org?.name || '企业'}</Title>
            {org && (
              <Text>编码: {org.code} | 分组: {org.group} | 有效总额: {renderQuota(quotaSummary.valid_total)} | 可用: {renderQuota(quotaSummary.available)} | 已用: {renderQuota(quotaSummary.used)} | 成员上限: {org.max_members}</Text>
            )}
          </Card>

      <Card
        title="部门管理"
        style={{ marginBottom: 16 }}
        headerExtraContent={<Button size="small" theme="solid" onClick={() => openCreateDept(0)}>新建部门</Button>}
      >
        {departments.length === 0 ? (
          <Text type="tertiary">暂无部门。capped 模式部门会强制累计预算上限，shared 仅作分组标签。</Text>
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={departments}
            columns={[
              { title: '部门', dataIndex: 'name', render: (v, r) => <span style={{ paddingLeft: r.parent_id ? 20 : 0 }}>{r.parent_id ? '└ ' : ''}{v}</span> },
              { title: '预算模式', dataIndex: 'budget_mode', render: (v) => v === 'capped' ? <Tag color="orange">强制上限</Tag> : <Tag color="grey">软标签</Tag> },
              { title: '预算上限', dataIndex: 'quota_cap', render: (v) => v < 0 ? '不限' : renderQuota(v) },
              { title: '累计已用', dataIndex: 'used_quota', render: (v) => renderQuota(v || 0) },
              { title: '状态', dataIndex: 'status', render: (v) => v === 2 ? <Tag color="red">禁用</Tag> : <Tag color="green">正常</Tag> },
              { title: '操作', render: (text, r) => (
                <Space>
                  <Button size="small" onClick={() => openCreateDept(r.id)}>加子部门</Button>
                  <Button size="small" onClick={() => openEditDept(r)}>编辑</Button>
                  <Button size="small" type="danger" onClick={() => handleDeleteDept(r.id)}>删除</Button>
                </Space>
              )},
            ]}
          />
        )}
      </Card>

      <Card title="成员管理" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Input placeholder="用户名" value={addUsername} onChange={setAddUsername} style={{ width: 200 }} />
            <Select value={addRole} onChange={setAddRole} style={{ width: 120 }}>
              <Select.Option value="member">成员</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
            <Button theme="solid" onClick={handleAddMember}>添加成员</Button>
            <Button theme="light" type="secondary" onClick={() => setShowGenerate(true)}>批量生成</Button>
            <Button theme="light" type="tertiary" onClick={() => setShowSelect(true)}>批量选择已有用户</Button>
            <Button theme="light" type="tertiary" onClick={() => setShowImport(true)}>批量导入</Button>
          </Space>
          {memberColumnConfigButton}
        </Space>
        <Table columns={memberVisibleColumns} dataSource={members} loading={loading} rowKey="id" pagination={false} />
      </Card>

      <Card title="邀请码管理" headerExtraContent={
        <Space>
          {inviteColumnConfigButton}
          <Button size="small" theme="solid" onClick={() => setShowInviteModal(true)}>生成邀请码</Button>
        </Space>
      }>
        <Table columns={inviteVisibleColumns} dataSource={invitations} rowKey="id" pagination={false} />
      </Card>

      <Card
        title="操作审计"
        style={{ marginTop: 16 }}
        headerExtraContent={
          <Space>
            {auditColumnConfigButton}
            <Select
              placeholder="按动作筛选"
              value={auditAction}
              onChange={(v) => { setAuditAction(v || ''); setAuditPage(1); }}
              optionList={[{ value: '', label: '全部动作' }, ...auditActionOptions]}
              style={{ width: 160 }}
            />
          </Space>
        }
      >
        <Table
          columns={auditVisibleColumns}
          dataSource={auditLogs}
          rowKey="id"
          pagination={{
            currentPage: auditPage,
            pageSize: 20,
            total: auditTotal,
            onPageChange: (p) => setAuditPage(p),
          }}
        />
      </Card>
        </ConfigPageTabPane>

        <ConfigPageTabPane tab="额度账本" itemKey="ledger">
          <Card style={{ marginBottom: 16 }}>
            <Space spacing={32} wrap>
              <div>
                <Text type="tertiary" size="small">有效总额</Text>
                <Title heading={4} style={{ margin: 0 }}>{renderQuota(quotaSummary.valid_total)}</Title>
              </div>
              <div>
                <Text type="tertiary" size="small">可用</Text>
                <Title heading={4} style={{ margin: 0 }}>{renderQuota(quotaSummary.available)}</Title>
              </div>
              <div>
                <Text type="tertiary" size="small">已用</Text>
                <Title heading={4} style={{ margin: 0 }}>{renderQuota(quotaSummary.used)}</Title>
              </div>
            </Space>
          </Card>

          <Card title="额度账本（全部批次）">
            <Space style={{ marginBottom: 12 }} wrap>
              <Select
                placeholder="来源"
                value={ledgerSource}
                onChange={(v) => setLedgerSource(v || '')}
                style={{ width: 140 }}
                optionList={[{ value: '', label: '全部来源' }, ...Object.keys(ledgerSourceLabels).map((k) => ({ value: k, label: ledgerSourceLabels[k] }))]}
              />
              <Select
                placeholder="状态"
                value={ledgerStatus}
                onChange={(v) => setLedgerStatus(v || '')}
                style={{ width: 140 }}
                optionList={[{ value: '', label: '全部状态' }, { value: 'valid', label: '有效' }, { value: 'expired', label: '已过期' }, { value: 'exhausted', label: '已耗尽' }]}
              />
              <Select
                placeholder="到期类型"
                value={ledgerExpiryType}
                onChange={(v) => setLedgerExpiryType(v || '')}
                style={{ width: 140 }}
                optionList={[{ value: '', label: '全部到期类型' }, { value: 'permanent', label: '永久' }, { value: 'timed', label: '有期限' }]}
              />
            </Space>
            <Table
              columns={[
                { title: '来源', dataIndex: 'source', render: (v) => <Tag>{ledgerSourceLabel(v)}</Tag> },
                { title: '总额', dataIndex: 'amount', render: (v) => renderQuota(v) },
                { title: '剩余', dataIndex: 'remaining', render: (v) => renderQuota(v) },
                { title: '状态', render: (_, r) => { const m = ledgerStatusMeta[ledgerRowStatus(r)]; return <Tag color={m.color}>{m.label}</Tag>; } },
                { title: '到期时间', dataIndex: 'expires_at', render: (v) => v ? new Date(v).toLocaleString() : <Tag color="green">永久</Tag> },
                { title: '备注', dataIndex: 'source_ref', render: (v) => v || '-' },
                { title: '创建时间', dataIndex: 'created_at', render: (v) => v ? new Date(v).toLocaleString() : '-' },
              ]}
              dataSource={breakdown.filter((r) => {
                if (ledgerSource && r.source !== ledgerSource) return false;
                if (ledgerStatus && ledgerRowStatus(r) !== ledgerStatus) return false;
                if (ledgerExpiryType === 'permanent' && r.expires_at) return false;
                if (ledgerExpiryType === 'timed' && !r.expires_at) return false;
                return true;
              })}
              rowKey="id"
              pagination={false}
              size="small"
              empty="暂无账本记录"
            />
          </Card>
        </ConfigPageTabPane>
      </ConfigPageTabs>

      <Modal title="操作详情" visible={!!auditDetail} footer={null} onCancel={() => setAuditDetail(null)}>
        {auditDetail && (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13, margin: 0 }}>
            {(() => { try { return JSON.stringify(JSON.parse(auditDetail.detail), null, 2); } catch { return auditDetail.detail; } })()}
          </pre>
        )}
      </Modal>
      <Modal
        title="密码验证"
        visible={showEditPassword}
        onOk={handleEditConfirm}
        onCancel={() => { setShowEditPassword(false); setEditPassword(''); }}
        okText="确认保存"
      >
        <p>请输入管理员密码以确认修改：</p>
        <Input type="password" placeholder="管理员密码" value={editPassword} onChange={setEditPassword} />
      </Modal>

      <Modal title="设置额度上限" visible={!!editMember} onOk={handleUpdateQuota} onCancel={() => setEditMember(null)}>
        <div style={{ marginBottom: 12 }}>
          <Select value={editUnlimited ? 'unlimited' : 'limited'} onChange={(v) => setEditUnlimited(v === 'unlimited')} style={{ width: '100%' }}>
            <Select.Option value="limited">指定额度</Select.Option>
            <Select.Option value="unlimited">不限额度</Select.Option>
          </Select>
        </div>
        {!editUnlimited && (
          <div style={{ display: 'flex', gap: 8 }}>
            <InputNumber min={0} placeholder="输入数量" value={editQuotaLimit} onChange={setEditQuotaLimit} style={{ flex: 1 }} />
            <Select value={editQuotaUnit} onChange={setEditQuotaUnit} optionList={unitOptions} style={{ width: 140 }} />
          </div>
        )}
        {!editUnlimited && editQuotaLimit > 0 && (
          <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
            设置额度：{Number(editQuotaLimit).toLocaleString()} {unitLabels[editQuotaUnit]} = {(Number(editQuotaLimit) * (unitMultipliers[editQuotaUnit] || 1000)).toLocaleString()} 积分
          </div>
        )}
      </Modal>

      <Modal title="生成邀请码" visible={showInviteModal} onOk={handleCreateInvitation} onCancel={() => setShowInviteModal(false)}>
        <Form layout="vertical">
          <Form.Slot label="角色">
            <Select value={inviteRole} onChange={setInviteRole}>
              <Select.Option value="member">成员</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Slot>
          <Form.Slot label="最大使用次数（0=无限）">
            <Input type="number" value={inviteMaxUses} onChange={setInviteMaxUses} />
          </Form.Slot>
          <Form.Slot label="有效天数">
            <Input type="number" value={inviteExpireDays} onChange={setInviteExpireDays} />
          </Form.Slot>
        </Form>
      </Modal>

      <Modal
        title="批量生成账号"
        visible={showGenerate}
        onOk={handleBatchGenerate}
        onCancel={() => setShowGenerate(false)}
        okText="开始生成"
        confirmLoading={generating}
        style={{ width: 520 }}
      >
        <Form layout="vertical">
          <Form.Slot label="账号前缀">
            <Input placeholder="如 parvis" value={genPrefix} onChange={setGenPrefix} />
          </Form.Slot>
          <Form.Slot label="生成数量">
            <InputNumber min={1} max={500} value={genCount} onChange={setGenCount} style={{ width: '100%' }} />
          </Form.Slot>
          <Form.Slot label="密码前缀">
            <Input placeholder="如 www，最终密码 = 密码前缀 + 账号名" value={genPasswordPrefix} onChange={setGenPasswordPrefix} />
          </Form.Slot>
          <Form.Slot label="角色">
            <Select value={genRole} onChange={setGenRole}>
              <Select.Option value="member">成员</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Slot>
        </Form>
        {genPrefix && genCount > 0 && (
          <div style={{ marginTop: 12, padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: 13 }}>
            <div><strong>预览：</strong></div>
            <div>账号：{genPrefix}1, {genPrefix}2, ... {genPrefix}{genCount}</div>
            <div>密码：{genPasswordPrefix}{genPrefix}1, {genPasswordPrefix}{genPrefix}2, ... {genPasswordPrefix}{genPrefix}{genCount}</div>
            <div>共 {genCount} 个账号</div>
            <div style={{ marginTop: 8, color: '#a64' }}>
              注：新账号注册时赠送的积分会在转入企业时被清零，所有计费走企业额度。
            </div>
          </div>
        )}
      </Modal>
      <Modal
        title="批量导入企业成员"
        visible={showImport}
        onOk={handleSubmitImport}
        onCancel={() => setShowImport(false)}
        okText="开始导入"
        confirmLoading={importing}
        style={{ width: 640 }}
      >
        <Form layout="vertical">
          <Form.Slot label="账号前缀">
            <Input placeholder="如 parvis，最终账号 = 前缀 + 工号" value={importPrefix} onChange={setImportPrefix} />
          </Form.Slot>
          <Form.Slot label="密码前缀">
            <Input placeholder="如 www，最终密码 = 密码前缀 + 账号名" value={importPasswordPrefix} onChange={setImportPasswordPrefix} />
          </Form.Slot>
          <Form.Slot label="角色">
            <Select value={importRole} onChange={setImportRole}>
              <Select.Option value="member">成员</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Slot>
          <Form.Slot label="花名册文件">
            <Upload
              accept=".xlsx,.xls,.csv"
              limit={1}
              beforeUpload={({ file }) => { handleImportFile(file); return false; }}
              draggable
              dragMainText="点击或拖拽 Excel/CSV 文件到此"
              dragSubText="表头需包含：工号、姓名、部门"
            />
          </Form.Slot>
        </Form>
        {importRows.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>{importFileName}</strong> — 解析到 {importRows.length} 行(预览前 5 行)
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={importRows.slice(0, 5).map((r, i) => ({ ...r, key: i }))}
              columns={[
                { title: '工号', dataIndex: 'employee_no' },
                { title: '姓名', dataIndex: 'name' },
                { title: '部门', dataIndex: 'dept' },
                { title: '生成账号', render: (t, r) => importPrefix + (r.employee_no || '(序号)') },
              ]}
            />
            <div style={{ marginTop: 8, color: '#a64' }}>
              注：部门按名称匹配已有部门(支持「父/子」路径),匹配不到的成员将留为未分配。新账号转入企业时赠送积分清零。
            </div>
          </div>
        )}
        {importResult && (
          <div style={{ marginTop: 12, padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: 13, maxHeight: 200, overflow: 'auto' }}>
            <div><strong>导入结果：</strong>成功 {importResult.success_count}/{importResult.total}</div>
            {importResult.results.filter((r) => !r.success || r.message).map((r) => (
              <div key={r.row} style={{ color: r.success ? '#a64' : '#c00' }}>
                第{r.row}行 {r.username}：{r.success ? r.message : ('失败 - ' + r.message)}
              </div>
            ))}
          </div>
        )}
      </Modal>
      <Modal
        title="批量选择已有用户加入企业"
        visible={showSelect}
        onOk={handleSubmitSelect}
        onCancel={() => setShowSelect(false)}
        okText={`加入企业${selectChosen.length ? ` (${selectChosen.length})` : ''}`}
        confirmLoading={selectSubmitting}
        style={{ width: 640 }}
      >
        <Space style={{ width: '100%', marginBottom: 12 }}>
          <Input
            placeholder="按用户名/邮箱前缀搜索"
            value={selectKeyword}
            onChange={setSelectKeyword}
            onEnterPress={handleSearchUsers}
            style={{ width: 320 }}
          />
          <Button onClick={handleSearchUsers} loading={selectSearching}>搜索</Button>
          <Select value={selectRole} onChange={setSelectRole} style={{ width: 110 }}>
            <Select.Option value="member">成员</Select.Option>
            <Select.Option value="admin">管理员</Select.Option>
          </Select>
        </Space>
        {selectChosen.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {selectChosen.map((u) => (
              <Tag key={u.id} closable onClose={() => toggleChosen(u)} style={{ marginRight: 4 }}>
                {u.username}
              </Tag>
            ))}
          </div>
        )}
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={selectResults}
          rowSelection={{
            selectedRowKeys: selectChosen.map((x) => x.id),
            onChange: (keys, rows) => setSelectChosen(rows.map((r) => ({ id: r.id, username: r.username }))),
          }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 70 },
            { title: '用户名', dataIndex: 'username' },
            { title: '昵称', dataIndex: 'display_name' },
            { title: '邮箱', dataIndex: 'email' },
          ]}
          empty="输入前缀后点击搜索"
          scroll={{ y: 280 }}
        />
        <div style={{ marginTop: 8, color: '#a64', fontSize: 13 }}>
          注：转入企业会清零这些用户的个人积分并取消其活跃订阅,转入后计费走企业额度,不可自动恢复。
        </div>
      </Modal>
      <Modal
        title={editDept?.id ? '编辑部门' : '新建部门'}
        visible={!!editDept}
        onOk={handleSaveDept}
        onCancel={() => setEditDept(null)}
      >
        <Form layout="vertical">
          <Form.Slot label="部门名称">
            <Input value={editDept?.name || ''} onChange={(v) => setEditDept({ ...editDept, name: v })} placeholder="如 研发部" />
          </Form.Slot>
          <Form.Slot label="上级部门">
            <Select
              value={editDept?.parent_id || 0}
              onChange={(v) => setEditDept({ ...editDept, parent_id: v })}
              style={{ width: '100%' }}
              optionList={[
                { value: 0, label: '顶级部门' },
                ...departments.filter((d) => d.id !== editDept?.id).map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </Form.Slot>
          <Form.Slot label="预算模式">
            <Select value={editDept?.budget_mode || 'shared'} onChange={(v) => setEditDept({ ...editDept, budget_mode: v })} style={{ width: '100%' }}>
              <Select.Option value="shared">软标签（仅分组统计，不拦截）</Select.Option>
              <Select.Option value="capped">强制上限（累计达上限后拒绝消费）</Select.Option>
            </Select>
          </Form.Slot>
          {editDept?.budget_mode === 'capped' && (
            <Form.Slot label="预算上限（积分，留空=不限）">
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                value={editDept?.quota_cap >= 0 ? editDept.quota_cap : ''}
                onChange={(v) => setEditDept({ ...editDept, quota_cap: v === '' || v === null ? -1 : v })}
                placeholder="不限"
              />
            </Form.Slot>
          )}
        </Form>
      </Modal>

      <Modal
        title={`设置日/月限额 — 用户 #${limitMember?.user_id ?? ''}`}
        visible={!!limitMember}
        onOk={handleSaveLimit}
        onCancel={() => setLimitMember(null)}
      >
        <div style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
          限额是节流闸门，资金仍来自企业账本。留空=不限；填 0=禁止该成员消费。每日 0 点重置日计数，每月 1 号重置月计数。
        </div>
        <Form layout="vertical">
          <Form.Slot label="日限额（积分）">
            <InputNumber min={0} style={{ width: '100%' }} value={limitDaily} onChange={(v) => setLimitDaily(v === null ? '' : String(v))} placeholder="不限" />
          </Form.Slot>
          <Form.Slot label="月限额（积分）">
            <InputNumber min={0} style={{ width: '100%' }} value={limitMonthly} onChange={(v) => setLimitMonthly(v === null ? '' : String(v))} placeholder="不限" />
          </Form.Slot>
        </Form>
      </Modal>
    </div>
  );
};

export default OrgMembers;
