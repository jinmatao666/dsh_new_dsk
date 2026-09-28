/** Public expert metadata returned by the Wanwei administration service. */
export type RemoteExpert = {
  key?: unknown
  name?: unknown
  subtitle?: unknown
  category?: unknown
  summary?: unknown
  icon?: unknown
  tags?: unknown
  scenario?: unknown
  materials?: unknown
  detail_sections?: unknown
  workbench_url?: unknown
}

/** One administrator-configured detail section. */
export type ExpertDetailSection = { title: string; subtitle: string; content: string }

/** Projected catalog entry from a published independent website. */
export type PublishedExpert = ExpertTemplate & {
  scenario?: string
  materials?: string
  detailSections?: readonly ExpertDetailSection[]
  workbenchUrl: string
}

type ExpertTemplate = {
  id: string
  name: string
  role: string
  category: string
  summary: string
  icon: string
  tags: readonly string[]
  examples: readonly string[]
  accent: string
}

/** Parse administrator-configured detail panels.
 * @param value - Untrusted JSON detail-section field.
 * @returns Valid sections, or undefined when absent or invalid.
 */
export function parseExpertDetailSections(value: unknown): readonly ExpertDetailSection[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 8) return undefined
    const sections = parsed.flatMap((section): ExpertDetailSection[] => {
      if (typeof section !== 'object' || section === null) return []
      const record = section as Record<string, unknown>
      if (typeof record.title !== 'string' || typeof record.subtitle !== 'string' || typeof record.content !== 'string') return []
      return [{ title: record.title, subtitle: record.subtitle, content: record.content }]
    })
    return sections.length === parsed.length ? sections : undefined
  } catch { return undefined }
}

/**
 * Show every valid published expert, including websites absent from desktop templates.
 * @param entries - Server-published expert records.
 * @param templates - Optional presentation details for legacy expert ids.
 * @returns Validated catalog entries in server order.
 */
export function projectPublishedExperts(
  entries: readonly RemoteExpert[], templates: readonly ExpertTemplate[],
): readonly PublishedExpert[] {
  return entries.flatMap((entry): PublishedExpert[] => {
    if (typeof entry.key !== 'string' || !/^[a-z][a-z0-9-]{2,79}$/.test(entry.key)) return []
    if (typeof entry.name !== 'string' || entry.name.trim() === '' || typeof entry.workbench_url !== 'string') return []
    let workbenchUrl: URL
    try { workbenchUrl = new URL(entry.workbench_url) }
    catch { return [] }
    if (!['http:', 'https:'].includes(workbenchUrl.protocol) || workbenchUrl.username !== '' || workbenchUrl.password !== '' || workbenchUrl.hash !== '') return []
    const template = templates.find(item => item.id === entry.key)
    let tags: string[] = []
    try {
      const parsed: unknown = JSON.parse(typeof entry.tags === 'string' ? entry.tags : '[]')
      if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string')
    } catch { /* Invalid tags cannot add catalog metadata. */ }
    const detailSections = parseExpertDetailSections(entry.detail_sections)
    return [{
      id: entry.key,
      name: entry.name,
      role: typeof entry.subtitle === 'string' ? entry.subtitle : (template?.role ?? ''),
      category: typeof entry.category === 'string' ? entry.category : (template?.category ?? '其他'),
      summary: typeof entry.summary === 'string' ? entry.summary : (template?.summary ?? ''),
      icon: typeof entry.icon === 'string' && entry.icon.trim() !== '' ? entry.icon : (template?.icon ?? 'writing'),
      tags,
      examples: template?.examples ?? [],
      accent: template?.accent ?? '#2563eb',
      workbenchUrl: workbenchUrl.href,
      scenario: typeof entry.scenario === 'string' ? entry.scenario : '',
      materials: typeof entry.materials === 'string' ? entry.materials : '',
      ...(detailSections === undefined ? {} : { detailSections }),
    }]
  })
}
