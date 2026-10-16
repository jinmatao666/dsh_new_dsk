import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel, Chip, Tooltip,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import api from '../api';
import { NoticeDialog, ConfirmDialog } from '../components/ActionDialog';

const budgetLabels = { shared: '共享(不拦)', capped: '封顶(强约束)' };
const budgetColors = { shared: '#8E8E93', capped: '#FF9F0A' };

// 按 parent_id 拼层级,返回带 depth 的有序数组
function buildTree(list) {
  const byParent = {};
  list.forEach((d) => {
    const p = d.parent_id || 0;
    (byParent[p] = byParent[p] || []).push(d);
  });
  const out = [];
  const walk = (parentId, depth) => {
    (byParent[parentId] || []).sort((a, b) => (a.sort - b.sort) || (a.id - b.id)).forEach((d) => {
      out.push({ ...d, depth });
      walk(d.id, depth + 1);
    });
  };
  walk(0, 0);
  return out;
}

export default function Departments() {
  const [depts, setDepts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null=新建, 否则编辑
  const [form, setForm] = useState({ parent_id: 0, name: '', budget_mode: 'shared', quota_cap: '', sort: 0, status: 1, default_daily: '', default_monthly: '' });
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    api.get('/departments').then((res) => {
      if (res.data.success) setDepts(res.data.data || []);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const tree = buildTree(depts);

  const openCreate = () => {
    setEditing(null);
    setForm({ parent_id: 0, name: '', budget_mode: 'shared', quota_cap: '', sort: 0, status: 1, default_daily: '', default_monthly: '' });
    setOpen(true);
  };

  const openEdit = (d) => {
    setEditing(d);
    setForm({
      parent_id: d.parent_id || 0,
      name: d.name,
      budget_mode: d.budget_mode || 'shared',
      quota_cap: d.quota_cap > 0 ? String(d.quota_cap) : '',
      sort: d.sort || 0,
      status: d.status || 1,
      default_daily: d.default_daily_cap > 0 ? String(d.default_daily_cap) : '',
      default_monthly: d.default_monthly_cap > 0 ? String(d.default_monthly_cap) : '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) return;
    const payload = {
      parent_id: Number(form.parent_id) || 0,
      name: form.name,
      budget_mode: form.budget_mode,
      quota_cap: form.quota_cap === '' ? -1 : Number(form.quota_cap),
      sort: Number(form.sort) || 0,
      status: Number(form.status) || 1,
    };
    const res = editing
      ? await api.put(`/departments/${editing.id}`, payload)
      : await api.post('/departments', payload);
    if (!res.data.success) { setNotice(res.data.message || '保存失败'); return; }
    // 默认限额走独立接口(留空=不限 -1)
    const deptId = editing ? editing.id : (res.data.data && res.data.data.id);
    if (deptId) {
      await api.put(`/departments/${deptId}/default-limit`, {
        daily_cap: form.default_daily === '' ? -1 : Number(form.default_daily),
        monthly_cap: form.default_monthly === '' ? -1 : Number(form.default_monthly),
      }).catch(() => {});
    }
    setOpen(false);
    load();
  };

  const handleDelete = async (d) => {
    setConfirm({ message: `确定删除部门「${d.name}」？有子部门或成员时无法删除。`, action: async () => {
      setConfirm(null);
      const res = await api.delete(`/departments/${d.id}`);
      if (res.data.success) load(); else setNotice(res.data.message || '删除失败');
    }});
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E' }}>部门管理</Typography>
        <Button variant="contained" size="small" onClick={openCreate} sx={{ height: 34, px: 2 }}>新建部门</Button>
      </Box>

      <TableContainer component={Paper} elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>部门名称</TableCell>
              <TableCell>预算模式</TableCell>
              <TableCell>额度上限</TableCell>
              <TableCell>已用</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tree.map((d) => (
              <TableRow key={d.id} sx={{ '&:hover': { bgcolor: '#FAFAFA' } }}>
                <TableCell>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, pl: d.depth * 2.5 }}>
                    {d.depth > 0 && <span style={{ color: '#C7C7CC' }}>└ </span>}{d.name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={budgetLabels[d.budget_mode] || d.budget_mode} size="small"
                    sx={{ bgcolor: `${budgetColors[d.budget_mode] || '#8E8E93'}15`, color: budgetColors[d.budget_mode] || '#8E8E93', fontWeight: 500, height: 24 }} />
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 13 }}>
                    {d.quota_cap === -1 || d.budget_mode === 'shared'
                      ? <span style={{ color: '#34C759', fontWeight: 500 }}>不限</span>
                      : d.quota_cap.toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell><Typography sx={{ fontSize: 13 }}>{(d.used_quota || 0).toLocaleString()}</Typography></TableCell>
                <TableCell>
                  <Chip label={d.status === 1 ? '启用' : '停用'} size="small"
                    sx={{ bgcolor: d.status === 1 ? '#34C75915' : '#FF3B3015', color: d.status === 1 ? '#34C759' : '#FF3B30', fontWeight: 500, height: 24 }} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="编辑">
                    <IconButton size="small" onClick={() => openEdit(d)} sx={{ color: '#8E8E93', '&:hover': { color: '#007AFF' } }}>
                      <EditIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton size="small" onClick={() => handleDelete(d)} sx={{ color: '#8E8E93', '&:hover': { color: '#FF3B30' } }}>
                      <DeleteIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {tree.length === 0 && (
              <TableRow><TableCell colSpan={6}>
                <Typography sx={{ fontSize: 13, color: '#8E8E93', py: 2, textAlign: 'center' }}>暂无部门,点击右上角新建</Typography>
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>{editing ? '编辑部门' : '新建部门'}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField fullWidth label="部门名称" size="small" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} sx={{ mb: 2 }} />
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>上级部门</InputLabel>
            <Select value={form.parent_id} label="上级部门"
              onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
              <MenuItem value={0}>顶级部门</MenuItem>
              {depts.filter((d) => !editing || d.id !== editing.id).map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>预算模式</InputLabel>
            <Select value={form.budget_mode} label="预算模式"
              onChange={(e) => setForm({ ...form, budget_mode: e.target.value })}>
              <MenuItem value="shared">共享(仅统计,不拦截)</MenuItem>
              <MenuItem value="capped">封顶(超额拦截,含子部门)</MenuItem>
            </Select>
          </FormControl>
          {form.budget_mode === 'capped' && (
            <TextField fullWidth label="额度上限(积分)" size="small" type="number" value={form.quota_cap}
              placeholder="留空表示不限" onChange={(e) => setForm({ ...form, quota_cap: e.target.value })} sx={{ mb: 2 }} />
          )}
          <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 1 }}>
            新成员默认限额(留空=不限)。仅对加入/调入本部门且尚无独立限额的成员生效,不影响已有成员。
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
            <TextField label="默认日限额" size="small" type="number" value={form.default_daily}
              placeholder="留空=不限" onChange={(e) => setForm({ ...form, default_daily: e.target.value })} sx={{ flex: 1 }} />
            <TextField label="默认月限额" size="small" type="number" value={form.default_monthly}
              placeholder="留空=不限" onChange={(e) => setForm({ ...form, default_monthly: e.target.value })} sx={{ flex: 1 }} />
          </Box>
          {editing && (
            <FormControl fullWidth size="small">
              <InputLabel>状态</InputLabel>
              <Select value={form.status} label="状态"
                onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <MenuItem value={1}>启用</MenuItem>
                <MenuItem value={2}>停用</MenuItem>
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} sx={{ color: '#8E8E93' }}>取消</Button>
          <Button variant="contained" onClick={handleSave}>保存</Button>
        </DialogActions>
      </Dialog>
      <NoticeDialog open={!!notice} message={notice} onClose={() => setNotice('')} />
      <ConfirmDialog open={!!confirm} message={confirm?.message} onCancel={() => setConfirm(null)} onConfirm={confirm?.action} />
    </Box>
  );
}
