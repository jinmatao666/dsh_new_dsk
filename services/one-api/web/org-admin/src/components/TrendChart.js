import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';

// TrendChart 手写 SVG 折线/面积图,贴合 macOS 极简风格(无第三方图表库).
// props:
//   data:        [{ day: '2026-06-01', value: 12345 }]
//   height:      画布高度(默认 180)
//   color:       主色(默认系统蓝)
//   formatValue: 数值格式化函数(用于 tooltip)
export default function TrendChart({ data = [], height = 180, color = '#007AFF', formatValue = (v) => v }) {
  const [hover, setHover] = useState(null);

  if (!data || data.length === 0) {
    return (
      <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 12, color: '#AEAEB2' }}>暂无数据</Typography>
      </Box>
    );
  }

  const W = 600; // viewBox 宽(等比缩放,响应式)
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22; // 底部留给 x 轴标签

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;

  const xAt = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (v) => padT + innerH - (v / max) * innerH;

  const points = data.map((d, i) => [xAt(i), yAt(d.value)]);
  const linePath = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath =
    `M ${points[0][0].toFixed(1)},${(padT + innerH).toFixed(1)} ` +
    points.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` L ${points[n - 1][0].toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  // 均匀分布的 x 轴刻度:在 [0, n-1] 上取 ~6 个等距索引(含首尾),去重避免末尾拥挤
  const tickCount = Math.min(n, 6);
  const tickSet = new Set();
  if (n === 1) {
    tickSet.add(0);
  } else {
    for (let i = 0; i < tickCount; i++) {
      tickSet.add(Math.round((i * (n - 1)) / (tickCount - 1)));
    }
  }
  const gridLines = [0.25, 0.5, 0.75].map((r) => padT + innerH * r);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    // 找最近的点
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - relX);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    setHover(idx);
  };

  const gradId = 'trendGrad';

  return (
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
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.14" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 网格线 */}
        {gridLines.map((y, i) => (
          <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
        ))}

        {/* 面积 */}
        <path d={areaPath} fill={`url(#${gradId})`} />

        {/* 折线 */}
        <polyline
          points={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* hover 竖线 + 点 */}
        {hover !== null && (
          <>
            <line
              x1={xAt(hover)}
              y1={padT}
              x2={xAt(hover)}
              y2={padT + innerH}
              stroke="rgba(0,0,0,0.12)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={xAt(hover)} cy={yAt(data[hover].value)} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
          </>
        )}
      </svg>

      {/* x 轴标签:HTML 叠加层按百分比定位,避免 SVG preserveAspectRatio=none 把文字横向拉伸 */}
      <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: padB, pointerEvents: 'none' }}>
        {data.map((d, i) =>
          tickSet.has(i) ? (
            <Typography key={i} sx={{
              position: 'absolute', top: 2,
              left: `${(xAt(i) / W) * 100}%`,
              transform: i === 0 ? 'none' : i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              fontSize: 10, color: '#AEAEB2', whiteSpace: 'nowrap',
            }}>
              {d.day.slice(5)}
            </Typography>
          ) : null
        )}
      </Box>

      {/* tooltip */}
      {hover !== null && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            left: `${(xAt(hover) / W) * 100}%`,
            transform: 'translateX(-50%)',
            px: 1,
            py: 0.5,
            borderRadius: '8px',
            bgcolor: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <Typography sx={{ fontSize: 10, color: '#8E8E93' }}>{data[hover].day}</Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#1C1C1E' }}>
            {formatValue(data[hover].value)}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
