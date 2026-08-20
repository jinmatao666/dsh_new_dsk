import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Select, MenuItem, FormControl, InputLabel, Chip, CircularProgress,
} from '@mui/material';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// 账本来源 -> 中文
const SOURCE_LABELS = {
  topup: '充值',
  admin: '管理员发放',
  refund: '退款',
  migration: '迁移',
  subscription: '订阅',
  monthly_free: '每月赠送',
};
const sourceLabel = (s) => SOURCE_LABELS[s] || s || '-';

// 由 (expires_at, remaining) 派生行状态:耗尽 > 过期 > 有效
function rowStatus(row) {
  if (Number(row.remaining) === 0) return 'exhausted';
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'valid';
}
const STATUS_META = {
  valid: { label: '有效', color: 'success' },
  expired: { label: '已过期', color: 'default' },
  exhausted: { label: '已耗尽', color: 'warning' },
};

function SummaryCard({ title, value, color }) {
  return (
    <Box sx={{
      flex: 1, minWidth: 0, p: 2, borderRadius: '10px',
      border: '1px solid rgba(0,0,0,0.06)', bgcolor: '#FFFFFF',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: color || '#1C1C1E' }}>{value}</Typography>
    </Box>
  );
}

export default function Ledger() {
  const { quotaPerUnit, updateQuotaPerUnit } = useAuth();
  const fmt = (q) => `${(q / quotaPerUnit).toFixed(2)} 积分`;
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ valid_total: 0, available: 0, used: 0 });
  const [loading, setLoading] = useState(true);
  // 客户端筛选
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [expiryType, setExpiryType] = useState('');

  useEffect(() => {
    api.get('/quota/ledger').then((res) => {
      if (res.data.success) {
        const d = res.data.data;
        setItems(d.items || []);
        if (d.summary) setSummary(d.summary);
        if (d.quota_per_unit) updateQuotaPerUnit(d.quota_per_unit);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => items.filter((r) => {
    if (source && r.source !== source) return false;
    if (status && rowStatus(r) !== status) return false;
    if (expiryType === 'permanent' && r.expires_at) return false;
    if (expiryType === 'timed' && !r.expires_at) return false;
    return true;
  }), [items, source, status, expiryType]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress size={28} /></Box>;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E', mb: 3 }}>额度账本</Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <SummaryCard title="有效总额" value={fmt(summary.valid_total)} />
        <SummaryCard title="可用" value={fmt(summary.available)} color="#34C759" />
        <SummaryCard title="已用" value={fmt(summary.used)} color="#007AFF" />
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>来源</InputLabel>
          <Select label="来源" value={source} onChange={(e) => setSource(e.target.value)}>
            <MenuItem value="">全部来源</MenuItem>
            {Object.keys(SOURCE_LABELS).map((k) => (
              <MenuItem key={k} value={k}>{SOURCE_LABELS[k]}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>状态</InputLabel>
          <Select label="状态" value={status} onChange={(e) => setStatus(e.target.value)}>
            <MenuItem value="">全部状态</MenuItem>
            <MenuItem value="valid">有效</MenuItem>
            <MenuItem value="expired">已过期</MenuItem>
            <MenuItem value="exhausted">已耗尽</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>到期类型</InputLabel>
          <Select label="到期类型" value={expiryType} onChange={(e) => setExpiryType(e.target.value)}>
            <MenuItem value="">全部到期类型</MenuItem>
            <MenuItem value="permanent">永久</MenuItem>
            <MenuItem value="timed">有期限</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <TableContainer component={Paper} sx={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.06)' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>来源</TableCell>
              <TableCell align="right">总额</TableCell>
              <TableCell align="right">剩余</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>到期时间</TableCell>
              <TableCell>备注</TableCell>
              <TableCell>创建时间</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ color: '#8E8E93', py: 4 }}>暂无账本记录</TableCell>
              </TableRow>
            ) : filtered.map((r) => {
              const m = STATUS_META[rowStatus(r)];
              return (
                <TableRow key={r.id} hover>
                  <TableCell><Chip size="small" label={sourceLabel(r.source)} /></TableCell>
                  <TableCell align="right">{fmt(r.amount)}</TableCell>
                  <TableCell align="right">{fmt(r.remaining)}</TableCell>
                  <TableCell><Chip size="small" color={m.color} label={m.label} /></TableCell>
                  <TableCell>{r.expires_at ? new Date(r.expires_at).toLocaleString() : '永久'}</TableCell>
                  <TableCell>{r.source_ref || '-'}</TableCell>
                  <TableCell>{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
