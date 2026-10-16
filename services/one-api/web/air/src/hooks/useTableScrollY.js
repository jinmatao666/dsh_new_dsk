import { useEffect, useRef, useState } from 'react';

/**
 * 自适应表格滚动高度（基于视口，不依赖父级高度链）。
 *
 * 用法：把返回的 ref 挂在「包裹 Table 的容器」上，
 * 把返回的 scrollY 传给 Semi Table 的 scroll={{ y: scrollY }}。
 *
 * 原理：用容器距视口顶部的距离 getBoundingClientRect().top，
 * 反推到视口底部还剩多少像素，再扣除表头+分页+底部留白，
 * 得到表体真正可用高度。窗口缩放、布局变化都自动跟随，
 * 无需依赖 height:100% 高度链。
 *
 * @param {object} opts
 * @param {number} opts.reserve 扣除的固定高度（表头+分页+底部留白），默认 120
 * @param {number} opts.min     最小高度，默认 160
 */
export default function useTableScrollY({ reserve = 120, min = 160 } = {}) {
  const ref = useRef(null);
  const [scrollY, setScrollY] = useState(360);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const h = window.innerHeight - top - reserve;
      setScrollY(Math.max(min, Math.floor(h)));
    };

    // 首帧布局未稳定，延迟一拍再量
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [reserve, min]);

  return [ref, scrollY];
}
