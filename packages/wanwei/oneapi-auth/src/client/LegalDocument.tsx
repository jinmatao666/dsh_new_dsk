import { brand, brandText } from '../brand.generated.ts'
import { LEGAL_VERSION, legalDocuments } from './legal-documents.ts'
import type { LegalKind } from './legal-documents.ts'
import css from './AuthGate.module.css'

/** Readable bundled document, independent of network and backend text fields. */
export function LegalDocument({ kind }: { kind: LegalKind }) {
  const document = legalDocuments[kind]
  return <article className={css.legalDocument}>
    <div className={css.legalMeta}>版本 {LEGAL_VERSION} · 生效日期 {LEGAL_VERSION}</div>
    <h1>{brandText(document.title)}</h1>
    <p className={css.legalLead}>{brandText(document.introduction)}</p>
    {document.sections.map(([title, text]) => <section key={title}><h2>{brandText(title)}</h2><p>{brandText(text)}</p></section>)}
    <footer>{brand.name} · 文档版本 {LEGAL_VERSION} · 请保留本版本供查阅</footer>
  </article>
}
