/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import * as echarts from 'echarts/core'
import { PieChart, BarChart, LineChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  PieChart,
  BarChart,
  LineChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CanvasRenderer,
])

/** Raster dimensions for the original Parvis chart renderer. */
export interface RenderChartOptions {
  width?: number
  height?: number
}

function injectLabels(option: Record<string, any>): Record<string, any> {
  if (!Array.isArray(option.series)) return option
  const series = option.series.map((s: any) => {
    if (s.type === 'pie') {
      return {
        ...s,
        // 长名称不省略：overflow:'break' 超宽换行 + 限宽 + 缩小字号，与编辑器 cal-service.js 一致
        label: s.label ?? {
          show: true,
          formatter: '{b}: {d}%',
          overflow: 'break',
          width: 130,
          fontSize: 11,
          lineHeight: 15,
        },
        labelLine: s.labelLine ?? { length: 15, length2: 20 },
      }
    }
    if (s.type === 'bar' || s.type === 'line') {
      return {
        ...s,
        label: s.label ?? { show: true, position: 'top' },
      }
    }
    return s
  })
  return { ...option, series }
}

/**
 * 清洗 AI 产出的不规范 echarts option，避免 setOption 抛 "option is not an Object"。
 * 已知问题：AI 常把 legend 写成纯字符串数组 ['耕地','园地']，而 echarts 把 legend 数组
 * 当作「多图例」逐个按对象处理，遇字符串元素即崩。规范写法是 { data: [...] }。
 */
function sanitizeOption(option: Record<string, any>): Record<string, any> {
  const out = { ...option }
  const v = out.legend
  if (v != null) {
    // 先修正结构：字符串数组 → {data:[...]}；对象 → 原样；标量 → 空对象交默认
    let legend: Record<string, any>
    if (Array.isArray(v)) {
      const allObjects = v.every(el => el && typeof el === 'object' && !Array.isArray(el))
      legend = allObjects ? { ...(v[0] as Record<string, any>) } : { data: v }
    } else if (typeof v === 'object') {
      legend = { ...v }
    } else {
      legend = {}
    }
    // 统一置底居中，与编辑器 mode1 重建（writing-chart-node.ts baseConfig legendlocation:'bottom'）一致，
    // 保证「对话预览」与「插入编辑器后」图例位置相同。清掉可能的 top 定位。
    delete legend.top
    legend.bottom = legend.bottom ?? 8
    legend.left = legend.left ?? 'center'
    legend.orient = legend.orient ?? 'horizontal'
    out.legend = legend
  }
  return out
}

/** Render a chart into the image inserted into a Word draft.
 * @param option - JSON chart configuration returned by the selected model.
 * @param opts - Optional raster dimensions.
 * @returns PNG data URL; the temporary chart is disposed after rendering.
 */
export async function renderChartToPng(
  option: Record<string, any> | string,
  opts: RenderChartOptions = {},
): Promise<string> {
  // 归一化：容忍传入 JSON 字符串（含双重编码），最终必须是对象，否则 echarts.setOption 会崩
  let opt: any = option
  for (let i = 0; i < 3 && typeof opt === 'string'; i++) {
    opt = JSON.parse(opt)
  }
  if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
    throw new Error('echartsOption 不是合法对象')
  }

  const width = opts.width ?? 720
  const height = opts.height ?? 400

  const container = document.createElement('div')
  container.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:-99999px;top:0;pointer-events:none;`
  document.body.appendChild(container)

  let chart: ReturnType<typeof echarts.init> | undefined
  try {
    chart = echarts.init(container, undefined, { renderer: 'canvas' })
    const enriched = injectLabels(sanitizeOption(opt))
    chart.setOption({ ...enriched, animation: false })
    // 等一帧确保 canvas 完成绘制
    await new Promise<void>(r => requestAnimationFrame(() => r()))
    return chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })
  } finally {
    chart?.dispose()
    container.remove()
  }
}
