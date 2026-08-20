import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel, Chip, Tabs, Tab, Tooltip, Checkbox,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

const roleLabels = { owner: '所有者', admin: '管理员', member: '成员' };
const roleColors = { owner: '#FF9F0A', admin: '#007AFF', member: '#8E8E93' };
const unitMultipliers = { k: 1000, w: 10000, m: 1000000, b: 1000000000 };
const unitLabels = { k: 'K (千)', w: 'W (万)', m: 'M (百万)', b: 'B (十亿)' };

// 表头别名 → 内部字段
const HEADER_ALIASES = {
  employee_no: ['工号', '员工号', 'employee_no', 'employeeno', 'eno', 'no', '编号'],
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

// 限额展示:-1=不限 0=禁用 >0=上限
const renderCap = (v) => {
  if (v === -1 || v === undefined || v === null) return '不限';
  if (v === 0) return '禁用';
  return v.toLocaleString();
};

// 相对时间(unix 秒):今天 / N天前 / 日期
const relativeTime = (unix) => {
  if (!unix) return '从未使用';
  const now = Math.floor(Date.now() / 1000);
  const diffDays = Math.floor((now - unix) / 86400);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 30) return `${diffDays} 天前`;
  return new Date(unix * 1000).toLocaleDateString();
};
// 闲置判断:无活跃或超过 30 天
const isIdle = (unix) => !unix || (Math.floor(Date.now() / 1000) - unix) > 30 * 86400;

export default function Members() {
  const { quotaPerUnit } = useAuth();
  const formatQuota = (q) => (q / quotaPerUnit).toFixed(2);

  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [editQuotaAmount, setEditQuotaAmount] = useState('');
  const [editQuotaUnit, setEditQuotaUnit] = useState('k');
  const [editUnlimited, setEditUnlimited] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'member', create: false });
  const [addTab, setAddTab] = useState(0);
  const [keyword, setKeyword] = useState('');
  // 部门 + 成员限额
  const [departments, setDepartments] = useState([]);
  const [memberLimits, setMemberLimits] = useState({}); // user_id -> {daily_cap, monthly_cap, daily_used, monthly_used}
  const [memberActivity, setMemberActivity] = useState({}); // user_id -> 最近活跃 unix 秒
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitMember, setLimitMember] = useState(null);
  const [limitDaily, setLimitDaily] = useState('');   // 空=不限
  const [limitMonthly, setLimitMonthly] = useState('');
  // 批量选择 + 批量设限
  const [selected, setSelected] = useState(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchDaily, setBatchDaily] = useState('');
  const [batchMonthly, setBatchMonthly] = useState('');
  // 批量导入
  const [importOpen, setImportOpen] = useState(false);
  const [importPrefix, setImportPrefix] = useState('');
  const [importPasswordPrefix, setImportPasswordPrefix] = useState('');
  const [importRole, setImportRole] = useState('member');
  const [importRows, setImportRows] = useState([]);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  // 排序:默认按使用量降序
  const [sortBy, setSortBy] = useState('used_quota');
  const [order, setOrder] = useState('desc');

  const load = useCallback(() => {
    const params = new URLSearchParams({ p: page, sort: sortBy, order });
    if (keyword) params.append('keyword', keyword);
    api.get(`/members?${params}`).then((res) => {
      if (res.data.success) {
        setMembers(res.data.data || []);
        setTotal(res.data.total || 0);
      }
    });
  }, [page, keyword, sortBy, order]);

  // 点列头切换排序:同列切升/降,换列默认降序并回第一页
  const toggleSort = (col) => {
    if (sortBy === col) {
      setOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setOrder('desc');
    }
    setPage(0);
  };
  const sortArrow = (col) => (sortBy === col ? (order === 'desc' ? ' ↓' : ' ↑') : '');

  const loadDepartments = useCallback(() => {
    api.get('/departments').then((res) => {
      if (res.data.success) setDepartments(res.data.data || []);
    });
  }, []);

  const loadMemberLimits = useCallback(() => {
    api.get('/member-limits').then((res) => {
      if (res.data.success) setMemberLimits(res.data.data || {});
    });
  }, []);

  const loadMemberActivity = useCallback(() => {
    api.get('/members/activity').then((res) => {
      if (res.data.success) setMemberActivity(res.data.data || {});
    });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDepartments(); loadMemberLimits(); loadMemberActivity(); }, [loadDepartments, loadMemberLimits, loadMemberActivity]);

  const deptName = (id) => {
    if (!id) return '未分配';
    const d = departments.find((x) => x.id === id);
    return d ? d.name : `#${id}`;
  };

  const handleSetDept = async (userId, deptId) => {
    const res = await api.put(`/members/${userId}/dept`, { dept_id: deptId });
    if (res.data.success) { loadDepartments(); load(); }
  };

  const openLimitModal = (m) => {
    const l = memberLimits[m.user_id];
    setLimitMember(m);
    setLimitDaily(l && l.daily_cap > 0 ? String(l.daily_cap) : '');
    setLimitMonthly(l && l.monthly_cap > 0 ? String(l.monthly_cap) : '');
    setLimitOpen(true);
  };

  const handleSaveLimit = async () => {
    if (!limitMember) return;
    // 空字符串 -> 不限(-1);0 -> 禁用;>0 -> 上限
    const daily = limitDaily === '' ? -1 : Number(limitDaily);
    const monthly = limitMonthly === '' ? -1 : Number(limitMonthly);
    const res = await api.put(`/members/${limitMember.user_id}/limit`, { daily_cap: daily, monthly_cap: monthly });
    if (res.data.success) { setLimitOpen(false); loadMemberLimits(); }
  };

  // 批量选择
  const toggleSelect = (userId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (prev.size === members.length && members.length > 0) return new Set();
      return new Set(members.map((m) => m.user_id));
    });
  };

  const handleBatchSaveLimit = async () => {
    const daily = batchDaily === '' ? -1 : Number(batchDaily);
    const monthly = batchMonthly === '' ? -1 : Number(batchMonthly);
    const res = await api.put('/member-limits/batch', {
      user_ids: Array.from(selected),
      daily_cap: daily,
      monthly_cap: monthly,
    });
    if (res.data.success) {
      setBatchOpen(false);
      setSelected(new Set());
      loadMemberLimits();
    }
  };

  const handleAdd = async () => {
    const payload = { ...form, create: addTab === 1 };
    if (addTab === 1 && (!form.username || !form.password)) return;
    if (addTab === 0 && !form.username) return;
    const res = await api.post('/members', payload);
    if (res.data.success) { setAddOpen(false); setForm({ username: '', password: '', role: 'member', create: false }); load(); }
  };

  const handleEdit = async () => {
    if (!editMember) return;
    const quotaValue = editUnlimited ? -1 : Number(editQuotaAmount) * (unitMultipliers[editQuotaUnit] || 1000);
    const res = await api.put(`/members/${editMember.user_id}`, {
      role: editMember.role,
      quota_limit: quotaValue,
      status: editMember.status,
    });
    if (res.data.success) { setEditOpen(false); load(); }
  };

  const handleRemove = async (userId) => {
    if (!window.confirm('确定移除该成员？')) return;
    await api.delete(`/members/${userId}`);
    load();
  };

  // 解析上传的 Excel/CSV
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
          window.alert('未解析到有效数据，请检查表头(工号/姓名/部门)与内容');
          return;
        }
        setImportRows(rows);
        setImportFileName(file.name);
      } catch (e) {
        window.alert('文件解析失败: ' + e.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSubmitImport = async () => {
    if (!importPrefix) { window.alert('请输入账号前缀'); return; }
    if (importRows.length === 0) { window.alert('请先上传并解析文件'); return; }
    setImporting(true);
    try {
      const res = await api.post('/members/import', {
        prefix: importPrefix,
        password_prefix: importPasswordPrefix,
        role: importRole,
        rows: importRows,
      });
      if (res.data.success) {
        setImportResult(res.data.data);
        load();
      } else {
        window.alert(res.data.message);
      }
    } catch (e) {
      window.alert('请求失败');
    }
    setImporting(false);
  };

  const resetImport = () => {
    setImportOpen(false);
    setImportRows([]);
    setImportFileName('');
    setImportResult(null);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E' }}>
          成员管理 <Typography component="span" sx={{ fontSize: 14, fontWeight: 500, color: '#8E8E93' }}>· 共 {total} 人</Typography>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField size="small" placeholder="搜索用户名" value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            sx={{ width: 200, '& .MuiOutlinedInput-root': { height: 34, fontSize: 13 } }} />
          {selected.size > 0 && (
            <Button variant="outlined" size="small" onClick={() => { setBatchDaily(''); setBatchMonthly(''); setBatchOpen(true); }}
              sx={{ height: 34, px: 2 }}>批量设限 ({selected.size})</Button>
          )}
          <Button variant="contained" size="small" onClick={() => setAddOpen(true)}
            sx={{ height: 34, px: 2 }}>添加成员</Button>
          <Button variant="outlined" size="small" onClick={() => setImportOpen(true)}
            sx={{ height: 34, px: 2 }}>批量导入</Button>
        </Box>
      </Box>

      <TableContainer component={Paper} elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={members.length > 0 && selected.size === members.length}
                  indeterminate={selected.size > 0 && selected.size < members.length}
                  onChange={toggleSelectAll}
                />
              </TableCell>
              <TableCell>用户名</TableCell>
              <TableCell>角色</TableCell>
              <TableCell>部门</TableCell>
              <TableCell
                onClick={() => toggleSort('quota_limit')}
                sx={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: sortBy === 'quota_limit' ? '#007AFF' : 'inherit' }}>
                额度上限{sortArrow('quota_limit')}
              </TableCell>
              <TableCell
                onClick={() => toggleSort('used_quota')}
                sx={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: sortBy === 'used_quota' ? '#007AFF' : 'inherit' }}>
                已用额度{sortArrow('used_quota')}
              </TableCell>
              <TableCell>日/月限额</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>最近活跃</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.user_id} sx={{ '&:hover': { bgcolor: '#FAFAFA' } }}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selected.has(m.user_id)} onChange={() => toggleSelect(m.user_id)} />
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{m.username}</Typography>
                </TableCell>
                <TableCell>
                  <Chip label={roleLabels[m.role] || m.role} size="small"
                    sx={{ bgcolor: `${roleColors[m.role] || '#8E8E93'}15`, color: roleColors[m.role] || '#8E8E93', fontWeight: 500, height: 24 }} />
                </TableCell>
                <TableCell>
                  <Select size="small" variant="standard" disableUnderline
                    value={m.dept_id || 0}
                    onChange={(e) => handleSetDept(m.user_id, e.target.value)}
                    sx={{ fontSize: 13, minWidth: 90 }}
                    renderValue={(v) => deptName(v)}>
                    <MenuItem value={0}>未分配</MenuItem>
                    {departments.filter((d) => d.status === 1).map((d) => (
                      <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 13 }}>
                    {m.quota_limit === -1 ? <span style={{ color: '#34C759', fontWeight: 500 }}>不限</span> : `${formatQuota(m.quota_limit)} 积分`}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 13 }}>{formatQuota(m.used_quota)} 积分</Typography>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography sx={{ fontSize: 12, color: '#8E8E93' }}>
                      日 {renderCap(memberLimits[m.user_id]?.daily_cap)} / 月 {renderCap(memberLimits[m.user_id]?.monthly_cap)}
                    </Typography>
                    <Button size="small" sx={{ minWidth: 0, px: 0.5, fontSize: 12 }} onClick={() => openLimitModal(m)}>设置</Button>
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip label={m.status === 1 ? '正常' : '禁用'} size="small"
                    sx={{ bgcolor: m.status === 1 ? '#34C75915' : '#FF3B3015', color: m.status === 1 ? '#34C759' : '#FF3B30', fontWeight: 500, height: 24 }} />
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 12, color: isIdle(memberActivity[m.user_id]) ? '#FF9F0A' : '#8E8E93' }}>
                    {relativeTime(memberActivity[m.user_id])}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="编辑">
                    <IconButton size="small" onClick={() => {
                      setEditMember({...m});
                      setEditUnlimited(m.quota_limit === -1);
                      setEditQuotaAmount('');
                      setEditQuotaUnit('k');
                      setEditOpen(true);
                    }} sx={{ color: '#8E8E93', '&:hover': { color: '#007AFF' } }}>
                      <EditIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                  {m.role !== 'owner' && (
                    <Tooltip title="移除">
                      <IconButton size="small" onClick={() => handleRemove(m.user_id)}
                        sx={{ color: '#8E8E93', '&:hover': { color: '#FF3B30' } }}>
                        <DeleteIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
        <Typography sx={{ fontSize: 12, color: '#8E8E93' }}>
          {page + 1} / {Math.max(1, Math.ceil(total / 10))}
        </Typography>
        <Button size="small" disabled={(page + 1) * 10 >= total} onClick={() => setPage(page + 1)}>下一页</Button>
      </Box>

      {/* 添加成员弹窗 */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>添加成员</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Tabs value={addTab} onChange={(_, v) => setAddTab(v)} sx={{ mb: 2, minHeight: 36,
            '& .MuiTab-root': { minHeight: 36, fontSize: 13, textTransform: 'none' } }}>
            <Tab label="已有用户" />
            <Tab label="创建新用户" />
          </Tabs>
          <TextField fullWidth label="用户名" size="small" value={form.username}
            onChange={(e) => setForm({...form, username: e.target.value})} sx={{ mb: 2 }} />
          {addTab === 1 && (
            <TextField fullWidth label="密码" size="small" type="password" value={form.password}
              onChange={(e) => setForm({...form, password: e.target.value})} sx={{ mb: 2 }} />
          )}
          <FormControl fullWidth size="small">
            <InputLabel>角色</InputLabel>
            <Select value={form.role} label="角色"
              onChange={(e) => setForm({...form, role: e.target.value})}>
              <MenuItem value="member">成员</MenuItem>
              <MenuItem value="admin">管理员</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ color: '#8E8E93' }}>取消</Button>
          <Button variant="contained" onClick={handleAdd}>确定</Button>
        </DialogActions>
      </Dialog>

      {/* 编辑成员弹窗 */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>编辑成员</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          {editMember && <>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>角色</InputLabel>
              <Select value={editMember.role} label="角色"
                onChange={(e) => setEditMember({...editMember, role: e.target.value})}>
                <MenuItem value="member">成员</MenuItem>
                <MenuItem value="admin">管理员</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>额度类型</InputLabel>
              <Select value={editUnlimited ? 'unlimited' : 'limited'} label="额度类型"
                onChange={(e) => setEditUnlimited(e.target.value === 'unlimited')}>
                <MenuItem value="limited">指定额度</MenuItem>
                <MenuItem value="unlimited">不限额度</MenuItem>
              </Select>
            </FormControl>
            {!editUnlimited && (
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField label="数量" size="small" type="number" value={editQuotaAmount}
                  onChange={(e) => setEditQuotaAmount(e.target.value)} sx={{ flex: 1 }} />
                <FormControl size="small" sx={{ width: 140 }}>
                  <InputLabel>单位</InputLabel>
                  <Select value={editQuotaUnit} label="单位"
                    onChange={(e) => setEditQuotaUnit(e.target.value)}>
                    <MenuItem value="k">K (千)</MenuItem>
                    <MenuItem value="w">W (万)</MenuItem>
                    <MenuItem value="m">M (百万)</MenuItem>
                    <MenuItem value="b">B (十亿)</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            )}
            {!editUnlimited && editQuotaAmount > 0 && (
              <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 2 }}>
                设置额度：{Number(editQuotaAmount).toLocaleString()} {unitLabels[editQuotaUnit]} = {(Number(editQuotaAmount) * (unitMultipliers[editQuotaUnit] || 1000)).toLocaleString()} 积分
              </Typography>
            )}
            <FormControl fullWidth size="small">
              <InputLabel>状态</InputLabel>
              <Select value={editMember.status} label="状态"
                onChange={(e) => setEditMember({...editMember, status: e.target.value})}>
                <MenuItem value={1}>正常</MenuItem>
                <MenuItem value={2}>禁用</MenuItem>
              </Select>
            </FormControl>
          </>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)} sx={{ color: '#8E8E93' }}>取消</Button>
          <Button variant="contained" onClick={handleEdit}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 成员日/月限额弹窗 */}
      <Dialog open={limitOpen} onClose={() => setLimitOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>
          设置消费限额{limitMember ? ` · ${limitMember.username}` : ''}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 2 }}>
            留空 = 不限；填 0 = 禁止消费；填正数 = 周期上限(积分)。资金仍来自企业总账本,此处仅节流。
          </Typography>
          <TextField fullWidth label="每日上限" size="small" type="number" value={limitDaily}
            placeholder="留空表示不限" onChange={(e) => setLimitDaily(e.target.value)} sx={{ mb: 2 }} />
          <TextField fullWidth label="每月上限" size="small" type="number" value={limitMonthly}
            placeholder="留空表示不限" onChange={(e) => setLimitMonthly(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setLimitOpen(false)} sx={{ color: '#8E8E93' }}>取消</Button>
          <Button variant="contained" onClick={handleSaveLimit}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 批量设限弹窗 */}
      <Dialog open={batchOpen} onClose={() => setBatchOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>
          批量设置消费限额 · {selected.size} 名成员
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 2 }}>
            将覆盖所选成员的现有限额。留空 = 不限；填 0 = 禁止消费；填正数 = 周期上限(积分)。
          </Typography>
          <TextField fullWidth label="每日上限" size="small" type="number" value={batchDaily}
            placeholder="留空表示不限" onChange={(e) => setBatchDaily(e.target.value)} sx={{ mb: 2 }} />
          <TextField fullWidth label="每月上限" size="small" type="number" value={batchMonthly}
            placeholder="留空表示不限" onChange={(e) => setBatchMonthly(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBatchOpen(false)} sx={{ color: '#8E8E93' }}>取消</Button>
          <Button variant="contained" onClick={handleBatchSaveLimit}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 批量导入弹窗 */}
      <Dialog open={importOpen} onClose={resetImport} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>批量导入企业成员</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
            <TextField label="账号前缀" size="small" value={importPrefix}
              placeholder="如 parvis" onChange={(e) => setImportPrefix(e.target.value)} sx={{ flex: 1 }} />
            <TextField label="密码前缀" size="small" value={importPasswordPrefix}
              placeholder="如 www" onChange={(e) => setImportPasswordPrefix(e.target.value)} sx={{ flex: 1 }} />
            <FormControl size="small" sx={{ width: 120 }}>
              <InputLabel>角色</InputLabel>
              <Select value={importRole} label="角色" onChange={(e) => setImportRole(e.target.value)}>
                <MenuItem value="member">成员</MenuItem>
                <MenuItem value="admin">管理员</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Button variant="outlined" component="label" size="small" sx={{ mb: 1 }}>
            选择 Excel / CSV 文件
            <input hidden type="file" accept=".xlsx,.xls,.csv"
              onChange={(e) => { if (e.target.files[0]) handleImportFile(e.target.files[0]); e.target.value = ''; }} />
          </Button>
          <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 1.5 }}>
            表头需包含：工号、姓名、部门。账号 = 前缀 + 工号，密码 = 密码前缀 + 账号；部门按名称匹配已有部门(支持「父/子」路径),匹配不到留未分配。
          </Typography>
          {importRows.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 13, mb: 1 }}>
                <strong>{importFileName}</strong> — 解析到 {importRows.length} 行(预览前 5 行)
              </Typography>
              <TableContainer component={Paper} elevation={0} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>工号</TableCell><TableCell>姓名</TableCell>
                      <TableCell>部门</TableCell><TableCell>生成账号</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importRows.slice(0, 5).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontSize: 12 }}>{r.employee_no}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.name}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.dept}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{importPrefix + (r.employee_no || '(序号)')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
          {importResult && (
            <Box sx={{ mt: 1.5, p: 1.5, bgcolor: '#F5F5F7', borderRadius: '8px', maxHeight: 180, overflow: 'auto' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>
                导入完成：成功 {importResult.success_count}/{importResult.total}
              </Typography>
              {importResult.results.filter((r) => !r.success || r.message).map((r) => (
                <Typography key={r.row} sx={{ fontSize: 12, color: r.success ? '#FF9F0A' : '#FF3B30' }}>
                  第{r.row}行 {r.username}：{r.success ? r.message : ('失败 - ' + r.message)}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={resetImport} sx={{ color: '#8E8E93' }}>关闭</Button>
          <Button variant="contained" onClick={handleSubmitImport} disabled={importing}>开始导入</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
