import React, { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { Table } from '@douyinfe/semi-ui';

/**
 * AdaptiveTable —— 统一列表组件
 *
 * 列宽规则（所有后台列表统一遵循）：
 *   1. 不出现横向滚动条；
 *   2. 每列按内容自适应取自然宽度，容器富余的宽度平分到各列，
 *      使列宽 = 内容宽 + 均分间距，整表恰好撑满容器。
 *
 * 实现：先以 table-layout:auto（不设列宽、不设 scroll.x）渲染，让浏览器
 * 按内容把表头铺开；用 ref 量出每个表头单元格的真实宽度，再把
 * (容器宽 - 内容总宽) / 列数 平均分摊到每列，切到 table-layout:fixed。
 * 因此不需要 scroll.x，浏览器也不会产生横向滚动。
 *
 * 用法与 Semi <Table> 一致，额外支持：
 *   - maxNaturalWidth：单列内容自然宽度上限（默认 280），防止超长文本霸占空间；
 *   - minColumnWidth：列最小宽度（默认 64），缩放时不被压得过窄。
 */
export default function AdaptiveTable({
  columns = [],
  maxNaturalWidth = 280,
  minColumnWidth = 64,
  ...rest
}) {
  const containerRef = useRef(null);
  const [widths, setWidths] = useState(null);
  const colCount = columns.length;

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container || colCount === 0) return;
    const ths = container.querySelectorAll('.semi-table-thead th');
    if (ths.length !== colCount) return;

    const natural = Array.from(ths).map((th) =>
      Math.min(Math.ceil(th.getBoundingClientRect().width), maxNaturalWidth)
    );
    const total = natural.reduce((a, b) => a + b, 0);
    const available = Math.floor(container.clientWidth);
    if (available <= 0) return;

    let next;
    if (total <= available) {
      const extra = (available - total) / colCount;
      next = natural.map((w) => Math.floor(w + extra));
    } else {
      const scale = available / total;
      next = natural.map((w) => Math.max(minColumnWidth, Math.floor(w * scale)));
    }
    // 余数补到最后一列，整表恰好撑满，杜绝 1px 横向滚动
    const sum = next.reduce((a, b) => a + b, 0);
    next[next.length - 1] += available - sum;

    setWidths((prev) =>
      prev && prev.length === next.length && prev.every((w, i) => w === next[i])
        ? prev
        : next
    );
  }, [colCount, maxNaturalWidth, minColumnWidth]);

  // 列结构变化时清空已算宽度，回到 auto 布局重新测量
  useLayoutEffect(() => {
    setWidths(null);
  }, [colCount]);

  useLayoutEffect(() => {
    if (widths === null) recompute();
  }, [widths, recompute]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      // 容器尺寸变化：回到 auto 重新测量
      setWidths(null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const appliedColumns = widths
    ? columns.map((c, i) => ({ ...c, width: widths[i] }))
    : columns.map(({ width, ...c }) => c); // 测量阶段：去掉固定宽度走 auto 布局

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <Table
        columns={appliedColumns}
        tableLayout={widths ? 'fixed' : 'auto'}
        {...rest}
      />
    </div>
  );
}
