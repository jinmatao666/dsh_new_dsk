import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';

// AreaChart 多序列归一化堆叠面积图(纯 SVG,无图表库).
// 每条序列各自归一到 [0,1](按本序列峰值),便于在同一张图里对比「趋势形状」而非绝对量级.
// props:
//   data:    [{ bucket: '2026-06-01', values: { active_users: n, requests: n, tokens: n } }]
//   series:  [{ key, label, color }]
//   height:  画布高度(默认 220)
//   formatBucket: x 轴标签格式化(默认取 MM-DD 或 HH:00)
export default function AreaChart({ data = [], series = [], height = 220, formatBucket }) {
  const [hover, setHover] = useState(null);

  if (!data || data.length === 0) {
    return (
      <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 12, color: '#AEAEB2' }}>暂无数据</Typography>
      </Box>
    );
  }

  const W = 760;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;

  // 每序列各自的峰值(归一化基准)
  const maxByKey = {};
  series.forEach((s) => {
    maxByKey[s.key] = Math.max(...data.map((d) => d.values[s.key] || 0), 1);
  });

  const xAt = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (norm) => padT + innerH - norm * innerH; // norm ∈ [0,1]

  const gridLines = [0.25, 0.5, 0.75].map((r) => padT + innerH * r);

  const fmtBucket = formatBucket || ((b) => (b.length > 10 ? b.slice(11) : b.slice(5)));
  // 均匀分布的 x 轴刻度:在 [0, n-1] 上取 ~7 个等距索引(含首尾),去重避免末尾拥挤
  const tickCount = Math.min(n, 7);
  const tickSet = new Set();
  if (n === 1) {
    tickSet.add(0);
  } else {
    for (let i = 0; i < tickCount; i++) {
      tickSet.add(Math.round((i * (n - 1)) / (tickCount - 1)));
    }
  }

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - relX);
      if (d < best) { best = d; idx = i; }
    }
    setHover(idx);
  };

  const buildPaths = (s) => {
    const max = maxByKey[s.key];
    const pts = data.map((d, i) => [xAt(i), yAt((d.values[s.key] || 0) / max)]);
    const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area =
      `M ${pts[0][0].toFixed(1)},${(padT + innerH).toFixed(1)} ` +
      pts.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
      ` L ${pts[n - 1][0].toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
    return { line, area };
  };

  return (
    <Box sx={{ width: '100%' }}>
      {/* 图例 */}
      <Box sx={{ display: 'flex', gap: 2.5, mb: 1, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: s.color }} />
            <Typography sx={{ fontSize: 12, color: '#636366' }}>{s.label}</Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ position: 'relative', width: '100%' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: 'block' }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {gridLines.map((y, i) => (
            <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
          ))}

          {series.map((s) => {
            const { line, area } = buildPaths(s);
            return (
              <g key={s.key}>
                <path d={area} fill={`url(#area-${s.key})`} />
                <polyline points={line} fill="none" stroke={s.color} strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}

          {hover !== null && (
            <line x1={xAt(hover)} y1={padT} x2={xAt(hover)} y2={padT + innerH}
              stroke="rgba(0,0,0,0.12)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          {hover !== null && series.map((s) => (
            <circle key={s.key} cx={xAt(hover)} cy={yAt((data[hover].values[s.key] || 0) / maxByKey[s.key])}
              r="3" fill={s.color} stroke="#fff" strokeWidth="1.5" />
          ))}
        </svg>

        {/* x 轴标签:用 HTML 叠加层按百分比定位,避免 SVG preserveAspectRatio=none 把文字横向拉伸 */}
        <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: padB, pointerEvents: 'none' }}>
          {data.map((d, i) =>
            tickSet.has(i) ? (
              <Typography key={i} sx={{
                position: 'absolute', top: 4,
                left: `${(xAt(i) / W) * 100}%`,
                transform: i === 0 ? 'none' : i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                fontSize: 10, color: '#AEAEB2', whiteSpace: 'nowrap',
              }}>
                {fmtBucket(d.bucket)}
              </Typography>
            ) : null
          )}
        </Box>

        {hover !== null && (
          <Box sx={{
            position: 'absolute', top: 4,
            left: `${(xAt(hover) / W) * 100}%`,
            transform: `translateX(${hover > n / 2 ? '-100%' : '0'})`,
            px: 1.25, py: 0.75, borderRadius: '8px', bgcolor: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            pointerEvents: 'none', whiteSpace: 'nowrap', minWidth: 120,
          }}>
            <Typography sx={{ fontSize: 10, color: '#8E8E93', mb: 0.5 }}>{data[hover].bucket}</Typography>
            {series.map((s) => (
              <Box key={s.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: 11, color: s.color, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.color, display: 'inline-block' }} />
                  {s.label}
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#1C1C1E' }}>
                  {(data[hover].values[s.key] || 0).toLocaleString()}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
