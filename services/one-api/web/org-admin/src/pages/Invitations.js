import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel, Tooltip, Chip,
} from '@mui/material';
import { Delete as DeleteIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import api from '../api';

export default function Invitations() {
  const [invitations, setInvitations] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ role: 'member', max_uses: 0, expire_days: 7 });

  const load = () => {
    api.get('/invitations').then((res) => {
      if (res.data.success) setInvitations(res.data.data || []);
    });
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    const res = await api.post('/invitation', form);
    if (res.data.success) { setOpen(false); load(); }
  };

  const handleDelete = async (code) => {
    if (!window.confirm('确定删除该邀请码？')) return;
    await api.delete(`/invitation/${code}`);
    load();
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E' }}>邀请管理</Typography>
        <Button variant="contained" size="small" onClick={() => setOpen(true)} sx={{ height: 34, px: 2 }}>
          生成邀请码
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>邀请码</TableCell>
              <TableCell>角色</TableCell>
              <TableCell align="center">使用次数</TableCell>
              <TableCell align="center">最大次数</TableCell>
              <TableCell>过期时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invitations.map((inv) => (
              <TableRow key={inv.id} sx={{ '&:hover': { bgcolor: '#FAFAFA' } }}>
                <TableCell>
                  <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: '#636366' }}>{inv.invite_code}</Typography>
                </TableCell>
                <TableCell>
                  <Chip label={inv.role === 'admin' ? '管理员' : '成员'} size="small"
                    sx={{ bgcolor: inv.role === 'admin' ? '#007AFF15' : '#8E8E9315', color: inv.role === 'admin' ? '#007AFF' : '#8E8E93', fontWeight: 500, height: 24 }} />
                </TableCell>
                <TableCell align="center">
                  <Typography sx={{ fontSize: 13 }}>{inv.used_count}</Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography sx={{ fontSize: 13 }}>{inv.max_uses || '不限'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 12, color: '#8E8E93' }}>
                    {inv.expired_at ? new Date(inv.expired_at).toLocaleDateString() : '永不'}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="复制">
                    <IconButton size="small" onClick={() => copyCode(inv.invite_code)}
                      sx={{ color: '#8E8E93', '&:hover': { color: '#007AFF' } }}>
                      <CopyIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton size="small" onClick={() => handleDelete(inv.invite_code)}
                      sx={{ color: '#8E8E93', '&:hover': { color: '#FF3B30' } }}>
                      <DeleteIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>生成邀请码</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>角色</InputLabel>
            <Select value={form.role} label="角色"
              onChange={(e) => setForm({...form, role: e.target.value})}>
              <MenuItem value="member">成员</MenuItem>
              <MenuItem value="admin">管理员</MenuItem>
            </Select>
          </FormControl>
          <TextField fullWidth label="最大使用次数 (0=不限)" size="small" type="number" value={form.max_uses}
            onChange={(e) => setForm({...form, max_uses: parseInt(e.target.value) || 0})} sx={{ mb: 2 }} />
          <TextField fullWidth label="有效天数" size="small" type="number" value={form.expire_days}
            onChange={(e) => setForm({...form, expire_days: parseInt(e.target.value) || 0})} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} sx={{ color: '#8E8E93' }}>取消</Button>
          <Button variant="contained" onClick={handleCreate}>生成</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
