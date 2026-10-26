import type { KnowledgeBaseItem, KnowledgeCategory } from './KnowledgePage.tsx'
import { productText } from './locales/product.ts'

/** One desktop knowledge navigation group. */
export interface LibraryGroup {
  key: string
  label: string
  rows: KnowledgeBaseItem[]
  create?: 'personal'
  createLabel?: string
}

function categoryIdOf(item: KnowledgeBaseItem): number {
  const id = item.category_id ?? 0
  return id > 0 ? id : 0
}

/**
 * Nav: 个人知识库, non-empty open categories, then 订阅知识库 for every accessible
 * library filed under an auth-required category. Auth category names never appear as
 * sidebar groups; those libraries are discovered in 知识库广场 and land here after approval.
 * @param items - Libraries the caller may open.
 * @param categories - Administrator-defined categories.
 * @returns Groups in display order; Personal is always present.
 */
export function libraryNavGroups(items: KnowledgeBaseItem[], categories: KnowledgeCategory[]): LibraryGroup[] {
  const categoryById = new Map(categories.map(category => [category.id, category]))
  const openCategoryGroups = categories.flatMap((category) => {
    if (category.require_auth) return []
    const rows = items.filter(item => categoryIdOf(item) === category.id)
    if (rows.length === 0) return []
    return [{
      key: `category-${category.id}`,
      label: category.name,
      rows,
    }]
  })
  const subscribed = items.filter((item) => {
    const category = categoryById.get(categoryIdOf(item))
    return category !== undefined && category.require_auth
  })
  const groups: LibraryGroup[] = [
    {
      key: 'personal', label: productText('个人知识库'), create: 'personal',
      createLabel: productText('新建个人知识库'),
      rows: items.filter(item => item.kind === 'personal' && categoryIdOf(item) === 0),
    },
    ...openCategoryGroups,
  ]
  if (subscribed.length !== 0) {
    groups.push({ key: 'subscription', label: productText('订阅知识库'), rows: subscribed })
  }
  return groups
}

/**
 * Default sidebar selection: first library in the first non-empty nav group.
 * @param items - Libraries the caller may open.
 * @param categories - Administrator-defined categories.
 * @returns Library id, or undefined when every group is empty.
 */
export function firstNavLibraryId(items: KnowledgeBaseItem[], categories: KnowledgeCategory[]): number | undefined {
  for (const group of libraryNavGroups(items, categories)) {
    const first = group.rows[0]
    if (first !== undefined) return first.id
  }
  return undefined
}
