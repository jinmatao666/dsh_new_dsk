import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Button, Select, MenuItem, FormControl, InputLabel, Chip, Tooltip,
} from '@mui/material';
import api from '../api';

// 审计动作 → 中文标签 + 颜色(与后端 OrgAuditAction* 常量对应)
const ACTION_LABELS = {
  dept_create: '创建部门',
  dept_update: '更新部门',
  dept_delete: '删除部门',
  member_set_dept: '调整部门',
  member_set_limit: '设置限额',
  dept_default_limit: '部门默认限额',
  member_add: '添加成员',
  member_update: '更新成员',
  member_remove: '移除成员',
  quota_topup: '额度充值',
};
const ACTION_COLORS = {
  dept_create: '#34C759', dept_update: '#007AFF', dept_delete: '#FF3B30',
  member_set_dept: '#007AFF', member_set_limit: '#FF9F0A', dept_default_limit: '#FF9F0A',
  member_add: '#34C759', member_update: '#007AFF', member_remove: '#FF3B30',
  quota_topup: '#34C759',
};

const PAGE_SIZE = 20;

// detail 是后端存的 JSON 字符串,紧凑展示
function formatDetail(detail) {
  if (!detail) return '';
  try {
    const obj = JSON.parse(detail);
    return Object.entries(obj)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');
  } catch {
    return detail;
  }
}

export default function AuditLogs() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); // 此接口 page 从 1 开始
  const [action, setAction] = useState('');

  const load = useCallback(() => {
    const params = { page, page_size: PAGE_SIZE };
    if (action) params.action = action;
    api.get('/audit-logs', { params }).then((res) => {
      if (res.data.success) {
        setItems(res.data.data.items || []);
        setTotal(res.data.data.total || 0);
      }
    });
  }, [page, action]);

  useEffect(() => { load(); }, [load]);

  // 切换筛选条件时回到第一页
  const onActionChange = (e) => { setAction(e.target.value); setPage(1); };

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E', mb: 2.5 }}>操作审计</Typography>

      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>操作类型</InputLabel>
          <Select label="操作类型" value={action} onChange={onActionChange}>
            <MenuItem value="">全部</MenuItem>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <MenuItem key={k} value={k}>{v}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ flexGrow: 1 }} />
        <Typography sx={{ fontSize: 12, color: '#8E8E93' }}>共 {total} 条</Typography>
      </Box>

      <TableContainer component={Paper} elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>时间</TableCell>
              <TableCell>操作</TableCell>
              <TableCell>操作人</TableCell>
              <TableCell>目标</TableCell>
              <TableCell>详情</TableCell>
              <TableCell>IP</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id} sx={{ '&:hover': { bgcolor: '#FAFAFA' } }}>
                <TableCell>
                  <Typography sx={{ fontSize: 12, color: '#636366', whiteSpace: 'nowrap' }}>
                    {new Date(r.created_at).toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={ACTION_LABELS[r.action] || r.action} size="small"
                    sx={{ bgcolor: `${ACTION_COLORS[r.action] || '#8E8E93'}15`, color: ACTION_COLORS[r.action] || '#8E8E93', fontWeight: 500, height: 24 }} />
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 13 }}>{r.actor_name || '企业'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 12, color: '#8E8E93' }}>
                    {r.target_type ? `${r.target_type}${r.target_id ? '#' + r.target_id : ''}` : '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Tooltip title={r.detail || ''}>
                    <Typography sx={{ fontSize: 12, color: '#636366', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatDetail(r.detail)}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: '#8E8E93' }}>{r.ip || '—'}</Typography>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography sx={{ fontSize: 13, color: '#8E8E93', py: 3 }}>暂无审计记录</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <Typography sx={{ fontSize: 12, color: '#8E8E93' }}>{page} / {maxPage}</Typography>
        <Button size="small" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>下一页</Button>
      </Box>
    </Box>
  );
}
