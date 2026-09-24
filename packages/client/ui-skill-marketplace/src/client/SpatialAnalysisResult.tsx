import { useEffect, useState } from 'react'
import css from './SpatialAnalysisResult.module.css'

export function SpatialAnalysisProgress({ createdAt }: { createdAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  const duration = `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
  return <div className={css.progress} role="status" aria-live="off">
    <span className={css.spinner} aria-hidden="true" />
    <span>任务仍在运行 · 已等待 {duration}</span>
    <small>页面会自动读取结果；耗时取决于数据和模型处理，不代表固定完成进度。</small>
  </div>
}

type AnswerSection = { heading: string; body: string[] }
function usefulSections(text: string): AnswerSection[] {
  const sections: AnswerSection[] = []
  let current: AnswerSection | null = null
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    const heading = line.match(/^#{1,3}\s+(.+)$/u)
    if (heading) {
      current = { heading: heading[1]?.replace(/\*\*/gu, '') ?? '', body: [] }
      sections.push(current)
      continue
    }
    if (current && line && !/^\|(?:\s*[-:]+\s*\|)+$/u.test(line)) current.body.push(line)
  }
  return sections.filter(section => section.body.length > 0 && !/原始返回|原始数据|生成文件|交付文件|成果文件/u.test(section.heading))
}

export function SpatialAnalysisAnswer({ text }: { text: string }) {
  const sections = usefulSections(text)
  return <section className={css.answer}>
    <h3>分析结论</h3>
    {sections.length > 0 ? sections.map(section => <div key={section.heading} className={css.section}>
      <h4>{section.heading}</h4>
      {section.body.filter(line => !/^\|/u.test(line) && !/[A-Z]:\\.*\.(?:json|md|docx|xlsx)/iu.test(line)).map((line, index) =>
        <p key={index}>{line.replace(/^(?:[-*•]|\d+\.)\s+/u, '').replace(/\*\*/gu, '')}</p>) }
    </div>) : <p>本次回答没有可单独提取的结论，请展开原始回答核对。</p>}
    <details><summary>查看完整模型回答（含原始数据与文件清单）</summary><pre>{text}</pre></details>
  </section>
}
