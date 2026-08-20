import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import TrendChart from '../components/TrendChart';

function QuotaRing({ used, total, size = 80 }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <Box sx={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 84 84" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="42" cy="42" r={r} fill="none" stroke="#E5E5EA" strokeWidth="6" />
        <circle cx="42" cy="42" r={r} fill="none" stroke="#007AFF" strokeWidth="6"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <Box sx={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#007AFF' }}>{pct.toFixed(1)}%</Typography>
        <Typography sx={{ fontSize: 10, color: '#8E8E93' }}>已使用</Typography>
      </Box>
    </Box>
  );
}

function StatCard({ title, value, sub, color }) {
  return (
    <Box sx={{
      flex: 1, minWidth: 0, p: 2, borderRadius: '10px',
      border: '1px solid rgba(0,0,0,0.06)',
      bgcolor: '#FFFFFF',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: color || '#1C1C1E' }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 11, color: '#AEAEB2', mt: 0.5 }}>{sub}</Typography>}
    </Box>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const { updateQuotaPerUnit, quotaPerUnit } = useAuth();

  const fmt = (q) => (q / quotaPerUnit).toFixed(2);

  useEffect(() => {
    api.get('/dashboard').then((res) => {
      if (res.data.success) {
        setData(res.data.data);
        if (res.data.data.quota_per_unit) {
          updateQuotaPerUnit(res.data.data.quota_per_unit);
        }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
    api.get('/dashboard/trend').then((res) => {
      if (res.data.success) setTrend(res.data.data);
    }).catch(() => {});
    api.get('/dashboard/health').then((res) => {
      if (res.data.success) setHealth(res.data.data);
    }).catch(() => {});
  }, []);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress size={28} /></Box>;
  if (!data) return <Typography sx={{ color: '#8E8E93', mt: 4 }}>加载失败</Typography>;

  // 总额直接取后端有效总额口径(未过期 SUM(amount)),不再由 quota+used_quota 二次相加,
  // 避免与账本页/air 口径漂移.兜底旧后端(无 valid_total)时回退老算法.
  const totalQuota = data.valid_total != null ? data.valid_total : data.quota + data.used_quota;
  const usedPct = totalQuota > 0 ? (data.used_quota / totalQuota) * 100 : 0;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E', mb: 3 }}>
        {data.org_name}
      </Typography>

      <Box sx={{
        p: 2.5, borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)',
        bgcolor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', mb: 3,
      }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#1C1C1E', mb: 2 }}>积分概览</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <QuotaRing used={data.used_quota} total={totalQuota} />
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: 11, color: '#8E8E93' }}>总额度</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#1C1C1E' }}>{fmt(totalQuota)} 积分</Typography>
            </Box>
            <Box sx={{
              height: 6, bgcolor: '#E5E5EA', borderRadius: 3, overflow: 'hidden',
            }}>
              <Box sx={{
                height: '100%', borderRadius: 3,
                width: `${Math.max(usedPct, 1)}%`, bgcolor: '#007AFF',
                transition: 'width 0.5s ease',
              }} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.2 }}>
              <Typography sx={{ fontSize: 10, color: '#8E8E93', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#007AFF', display: 'inline-block' }} />
                已使用 {fmt(data.used_quota)}
              </Typography>
              <Typography sx={{ fontSize: 10, color: '#8E8E93', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#34C759', display: 'inline-block' }} />
                剩余 {fmt(data.quota)}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <StatCard title="剩余额度" value={`${fmt(data.quota)} 积分`} sub={`${data.quota.toLocaleString()} token`} color="#34C759" />
        <StatCard title="已用额度" value={`${fmt(data.used_quota)} 积分`} sub={`${data.used_quota.toLocaleString()} token`} color="#007AFF" />
        <StatCard title="成员数" value={data.member_count} sub={`上限 ${data.max_members}`} />
      </Box>

      {trend && (
        <Box sx={{
          mt: 3, p: 2.5, borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)',
          bgcolor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#1C1C1E' }}>近 30 天消耗趋势</Typography>
            <Box sx={{ display: 'flex', gap: 3 }}>
              <Box sx={{ textAlign: 'right' }}>
                <Typography sx={{ fontSize: 10, color: '#8E8E93' }}>本月消耗</Typography>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: '#1C1C1E' }}>{fmt(trend.this_month)} 积分</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography sx={{ fontSize: 10, color: '#8E8E93' }}>环比上月</Typography>
                <Typography sx={{
                  fontSize: 14, fontWeight: 600,
                  color: trend.mom_pct > 0 ? '#FF3B30' : trend.mom_pct < 0 ? '#34C759' : '#8E8E93',
                }}>
                  {trend.last_month > 0 ? `${trend.mom_pct > 0 ? '+' : ''}${trend.mom_pct.toFixed(1)}%` : '—'}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography sx={{ fontSize: 10, color: '#8E8E93' }}>预计可用</Typography>
                <Typography sx={{
                  fontSize: 14, fontWeight: 600,
                  color: trend.days_to_exhaust < 0 ? '#34C759'
                    : trend.days_to_exhaust < 7 ? '#FF3B30'
                    : trend.days_to_exhaust < 14 ? '#FF9F0A' : '#1C1C1E',
                }}>
                  {trend.days_to_exhaust < 0 ? '充足' : `${Math.floor(trend.days_to_exhaust)} 天`}
                </Typography>
              </Box>
            </Box>
          </Box>
          <TrendChart
            data={(trend.trend || []).map((t) => ({ day: t.day, value: t.quota }))}
            formatValue={(v) => `${fmt(v)} 积分`}
          />
        </Box>
      )}

      {health && (
        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <StatCard
            title={`失败率（近 ${health.days} 天）`}
            value={`${(health.failure_rate * 100).toFixed(2)}%`}
            sub={`${health.error_count.toLocaleString()} / ${(health.consume_count + health.error_count).toLocaleString()} 次请求`}
            color={health.failure_rate > 0.05 ? '#FF3B30' : '#34C759'}
          />
          <StatCard
            title={`慢请求占比（近 ${health.days} 天）`}
            value={`${(health.slow_ratio * 100).toFixed(2)}%`}
            sub={`${health.slow_count.toLocaleString()} / ${health.consume_count.toLocaleString()} 次`}
            color={health.slow_ratio > 0.1 ? '#FF9F0A' : '#34C759'}
          />
        </Box>
      )}
    </Box>
  );
}
