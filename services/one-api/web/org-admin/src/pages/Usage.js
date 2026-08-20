import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Button, Select, MenuItem, FormControl, InputLabel, TextField, Tabs, Tab,
} from '@mui/material';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import AreaChart from '../components/AreaChart';

// 按 parent_id 拼层级,返回带 depth 的有序数组(用于部门下拉缩进)
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

// 本地日期(yyyy-MM-ddTHH:mm)→ unix 秒
const toUnix = (s) => (s ? Math.floor(new Date(s).getTime() / 1000) : 0);

// Date → datetime-local 字符串(yyyy-MM-ddTHH:mm),按本地时区
const toLocalInput = (d) => {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 快捷时间范围预设 → 返回 [start, end] 的 datetime-local 字符串
const rangePresets = {
  today: () => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    return [toLocalInput(s), toLocalInput(now)];
  },
  week: () => {
    const now = new Date();
    const day = (now.getDay() + 6) % 7; // 周一为一周起点
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 0, 0, 0);
    return [toLocalInput(s), toLocalInput(now)];
  },
  month: () => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    return [toLocalInput(s), toLocalInput(now)];
  },
};

export default function Usage() {
  const { quotaPerUnit } = useAuth();
  const formatQuota = (quota) => (quota / quotaPerUnit).toFixed(4);
  const [dim, setDim] = useState(0); // 0=成员维度 1=模型维度
  const [members, setMembers] = useState([]);
  const [models, setModels] = useState([]);
  const [stat, setStat] = useState(null);
  const [series, setSeries] = useState([]);
  const [activeUsers, setActiveUsers] = useState(0);
  const [depts, setDepts] = useState([]);
  // 筛选条件
  const [deptId, setDeptId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [preset, setPreset] = useState('month'); // today|week|month|custom

  // 初始默认「本月」
  useEffect(() => {
    const [s, e] = rangePresets.month();
    setStart(s);
    setEnd(e);
  }, []);

  const applyPreset = (key) => {
    setPreset(key);
    if (key !== 'custom' && rangePresets[key]) {
      const [s, e] = rangePresets[key]();
      setStart(s);
      setEnd(e);
    }
  };

  // 构造查询参数(部门 + 时间)
  const buildParams = useCallback(() => {
    const params = {};
    if (deptId) params.dept_id = deptId;
    if (start) params.start = toUnix(start);
    if (end) params.end = toUnix(end);
    return params;
  }, [deptId, start, end]);

  const loadMembers = useCallback(() => {
    api.get('/usage/members', { params: buildParams() }).then((res) => {
      if (res.data.success) setMembers(res.data.data || []);
    });
  }, [buildParams]);

  const loadModels = useCallback(() => {
    api.get('/usage/models', { params: buildParams() }).then((res) => {
      if (res.data.success) setModels(res.data.data || []);
    });
  }, [buildParams]);

  const loadStat = useCallback(() => {
    api.get('/logs/stat', { params: buildParams() }).then((res) => {
      if (res.data.success) setStat(res.data.data);
    });
  }, [buildParams]);

  const loadSeries = useCallback(() => {
    const params = buildParams();
    // 区间 ≤ 2 天用小时粒度,否则按天
    const s = start ? toUnix(start) : 0;
    const e = end ? toUnix(end) : 0;
    if (s && e && e - s <= 2 * 86400) params.granularity = 'hour';
    api.get('/usage/series', { params }).then((res) => {
      if (res.data.success) {
        setSeries(res.data.data.series || []);
        setActiveUsers(res.data.data.active_users || 0);
      }
    });
  }, [buildParams, start, end]);

  useEffect(() => {
    api.get('/departments').then((res) => {
      if (res.data.success) setDepts(buildTree(res.data.data || []));
    });
  }, []);

  useEffect(() => { loadStat(); }, [loadStat]);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { loadModels(); }, [loadModels]);
  useEffect(() => { loadSeries(); }, [loadSeries]);

  const onFilterChange = (setter) => (e) => setter(e.target.value);

  // 导出当前维度为 CSV(前端生成,含 BOM 以兼容 Excel UTF-8)
  const exportCsv = () => {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let header;
    let lines;
    let name;
    if (dim === 0) {
      header = ['用户', '请求数', '提示词', '补全', '消耗(积分)'];
      lines = members.map((m) =>
        [m.username || m.user_id, m.request_count, m.prompt_tokens, m.completion_tokens, formatQuota(m.quota)].join(','));
      name = `usage_members_${ymd}.csv`;
    } else {
      header = ['模型', '请求数', '提示词', '补全', '消耗(积分)'];
      lines = models.map((m) =>
        [m.model_name || '(未知)', m.request_count, m.prompt_tokens, m.completion_tokens, formatQuota(m.quota)].join(','));
      name = `usage_models_${ymd}.csv`;
    }
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E', mb: 2.5 }}>用量统计</Typography>

      {/* 筛选栏 */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, bgcolor: '#F2F2F7', borderRadius: '8px' }}>
          {[['today', '今天'], ['week', '本周'], ['month', '本月'], ['custom', '自定义']].map(([key, label]) => (
            <Button key={key} size="small" disableElevation
              onClick={() => applyPreset(key)}
              sx={{
                minWidth: 0, px: 1.5, py: 0.25, fontSize: 12, borderRadius: '6px',
                color: preset === key ? '#007AFF' : '#636366',
                bgcolor: preset === key ? '#FFFFFF' : 'transparent',
                boxShadow: preset === key ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                '&:hover': { bgcolor: preset === key ? '#FFFFFF' : 'rgba(0,0,0,0.03)' },
              }}>
              {label}
            </Button>
          ))}
        </Box>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>部门</InputLabel>
          <Select label="部门" value={deptId} onChange={onFilterChange(setDeptId)}>
            <MenuItem value="">全部部门</MenuItem>
            {depts.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {' '.repeat(d.depth * 2)}{d.depth > 0 ? '└ ' : ''}{d.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {preset === 'custom' && (
          <>
            <TextField
              size="small" type="datetime-local" label="开始时间"
              InputLabelProps={{ shrink: true }}
              value={start} onChange={(e) => setStart(e.target.value)}
            />
            <TextField
              size="small" type="datetime-local" label="结束时间"
              InputLabelProps={{ shrink: true }}
              value={end} onChange={(e) => setEnd(e.target.value)}
            />
          </>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" variant="outlined" onClick={exportCsv}>导出 CSV</Button>
      </Box>

      {stat && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <Box sx={{
            flex: 1, p: 2, borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)',
            bgcolor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 0.5 }}>活跃用户</Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: '#34C759' }}>{activeUsers}</Typography>
          </Box>
          <Box sx={{
            flex: 1, p: 2, borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)',
            bgcolor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 0.5 }}>总请求数</Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: '#1C1C1E' }}>{stat.total_count}</Typography>
          </Box>
          <Box sx={{
            flex: 1, p: 2, borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)',
            bgcolor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 0.5 }}>总消耗额度</Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: '#007AFF' }}>{formatQuota(stat.total_quota)} 积分</Typography>
          </Box>
        </Box>
      )}

      {/* 多序列归一化趋势图:活跃用户 / 调用次数 / Token 消耗 */}
      <Box sx={{
        p: 2.5, mb: 3, borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)',
        bgcolor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#1C1C1E', mb: 0.5 }}>用量趋势</Typography>
        <Typography sx={{ fontSize: 11, color: '#AEAEB2', mb: 1.5 }}>各序列按自身峰值归一化,用于对比变化趋势</Typography>
        <AreaChart
          data={series.map((p) => ({
            bucket: p.bucket,
            values: { active_users: p.active_users, requests: p.requests, tokens: p.tokens },
          }))}
          series={[
            { key: 'active_users', label: '活跃用户', color: '#34C759' },
            { key: 'requests', label: '调用次数', color: '#007AFF' },
            { key: 'tokens', label: 'Token 消耗', color: '#FF9F0A' },
          ]}
        />
      </Box>


      <Tabs
        value={dim}
        onChange={(e, v) => setDim(v)}
        sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontSize: 13, textTransform: 'none' } }}
      >
        <Tab label="成员维度" />
        <Tab label="模型维度" />
      </Tabs>

      {dim === 0 ? (
        <TableContainer component={Paper} elevation={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>用户</TableCell>
                <TableCell align="right">请求数</TableCell>
                <TableCell align="right">提示词</TableCell>
                <TableCell align="right">补全</TableCell>
                <TableCell align="right">消耗(积分)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id} sx={{ '&:hover': { bgcolor: '#FAFAFA' } }}>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{m.username || m.user_id}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{m.request_count}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{m.prompt_tokens}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{m.completion_tokens}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#007AFF' }}>{formatQuota(m.quota)}</Typography>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography sx={{ fontSize: 13, color: '#8E8E93', py: 3 }}>暂无数据</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <TableContainer component={Paper} elevation={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>模型</TableCell>
                <TableCell align="right">请求数</TableCell>
                <TableCell align="right">提示词</TableCell>
                <TableCell align="right">补全</TableCell>
                <TableCell align="right">消耗(积分)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.model_name || '(未知)'} sx={{ '&:hover': { bgcolor: '#FAFAFA' } }}>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, fontFamily: 'monospace' }}>{m.model_name || '(未知)'}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{m.request_count}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{m.prompt_tokens}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{m.completion_tokens}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#007AFF' }}>{formatQuota(m.quota)}</Typography>
                  </TableCell>
                </TableRow>
              ))}
              {models.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography sx={{ fontSize: 13, color: '#8E8E93', py: 3 }}>暂无数据</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
