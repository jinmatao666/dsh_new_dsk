import { productText } from './locales/product.ts'
import type { ExpertDetailSection } from './expert-catalog.ts'
import styles from './ExpertDetailDialog.module.css'

export type ExpertDetail = {
  name: string
  role: string
  summary: string
  icon: string
  scenario?: string
  materials?: string
  detailSections?: readonly ExpertDetailSection[]
  footerNote?: string
  tags: readonly string[]
}

function DetailIcon({ index }: { index: number }) {
  const names = ['home', 'files', 'result', 'layers'] as const
  return <img src={`/expert-icons/${names[index % names.length]}.png`} alt="" aria-hidden="true" />
}

function ExpertMark({ icon }: { icon: string }) {
  if (icon.startsWith('data:image/')) return <img src={icon} alt="" aria-hidden="true" />
  if (icon === 'meeting') return <svg viewBox="0 0 48 48" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="5" width="29" height="37" rx="4" /><path d="M15 13h17M15 18h17M27 23h5M27 28h5M27 33h5" /><rect x="16" y="23" width="6" height="11" rx="3" /><path d="M13 30a6 6 0 0 0 12 0m-6 6v4m-4 0h8" /></svg>
  return <svg viewBox="0 0 48 48" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="10" y="5" width="28" height="38" rx="4" /><path d="M16 15h16M16 21h16M16 27h12M16 33h9" /></svg>
}

function fallbackSections(expert: ExpertDetail): readonly ExpertDetailSection[] {
  return [
    { title: productText('适用场景'), subtitle: productText('场景应用'), content: expert.scenario || expert.summary },
    { title: productText('需要准备的材料'), subtitle: productText('材料要求'), content: expert.materials || productText('请在专家工作台查看所需材料。') },
    { title: productText('本专家交付'), subtitle: productText('输出内容'), content: expert.summary },
    { title: productText('处理原则'), subtitle: productText('能力范围'), content: productText('请以专家工作台实际处理结果为准，重要内容仍需结合原始材料复核。') },
  ]
}

export function ExpertDetailDialog({ expert, launching, launchError, onClose, onStart }: {
  expert: ExpertDetail
  launching: boolean
  launchError: string | null
  onClose: () => void
  onStart: () => void
}) {
  const sections = expert.detailSections?.length ? expert.detailSections : fallbackSections(expert)
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={productText('{0}详情', [expert.name])} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.avatar}><ExpertMark icon={expert.icon} /></span>
          <div><h2>{expert.name}</h2><p>{expert.role}</p><small>{expert.summary}</small></div>
        </div>
        <button className={styles.close} type="button" onClick={onClose} aria-label={productText('关闭')}>×</button>
      </header>
      <div className={styles.grid}>
        {sections.map((section, index) => <section className={styles.card} key={`${section.title}-${index}`}>
          <div className={styles.cardHeading}><DetailIcon index={index} /><h3>{section.title}</h3><span>{section.subtitle}</span></div>
          {section.content.includes('\n') ? <ul>{section.content.split('\n').map(line => line.trim()).filter(Boolean).map((line, lineIndex) => <li key={`${line}-${lineIndex}`}>{line}</li>)}</ul> : <p>{section.content}</p>}
        </section>)}
      </div>
      <footer className={styles.footer}>
        <small role={launchError ? 'alert' : undefined}>{launchError ?? (expert.footerNote?.trim() || productText('将在桌面端打开独立专家网页。'))}</small>
        <div><button className={styles.cancel} type="button" onClick={onClose}>{productText('取消')}</button><button className={styles.start} type="button" disabled={launching} onClick={onStart}>{launching ? productText('正在打开…') : productText('开始使用')}</button></div>
      </footer>
    </section>
  </div>
}
