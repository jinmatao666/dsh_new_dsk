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

/** Whether the caller owns this library (server annotation, with owner_user_id fallback).
 * @param item - Authorized library row.
 * @param selfUserId - Caller id inferred from an uncategorized personal library when annotation is absent.
 */
export function libraryOwnedByViewer(item: KnowledgeBaseItem, selfUserId?: number): boolean {
  if (item.owned_by_viewer === true) return true
  if (item.owned_by_viewer === false) return false
  return selfUserId !== undefined && item.owner_user_id === selfUserId
}

/** Whether the caller holds a non-ownership grant (subscription / direct / department).
 * @param item - Authorized library row.
 * @param selfUserId - Caller id fallback when annotations are absent.
 */
export function librarySubscribedByViewer(item: KnowledgeBaseItem, selfUserId?: number): boolean {
  if (libraryOwnedByViewer(item, selfUserId)) return false
  if (item.subscribed_by_viewer === true) return true
  if (item.subscribed_by_viewer === false) return false
  // Legacy servers without the annotation: never treat unknown access as a subscription.
  return false
}

/** Whether 取消订阅 is safe: only a granted (non-owned) subscription.
 * @param item - Authorized library row.
 * @param selfUserId - Caller id fallback when annotations are absent.
 */
export function libraryIsGrantedSubscription(item: KnowledgeBaseItem, selfUserId?: number): boolean {
  return librarySubscribedByViewer(item, selfUserId)
}

/**
 * Nav: 个人知识库 and 订阅知识库 are always present (empty groups stay visible). 公共知识库
 * merges every open category plus uncategorized common libraries and appears only when
 * non-empty. 订阅知识库 holds only grant-backed subscriptions (not self-built auth libraries).
 * Auth category names never appear as sidebar groups; self-built and discoverable auth
 * libraries appear in 知识库广场 (owned cards sort last with status 我的).
 * @param items - Libraries the caller may open.
 * @param categories - Administrator-defined categories.
 * @param selfUserId - Optional fallback owner id when ownership annotation is absent.
 * @returns Groups in display order; Personal and Subscription are always present.
 */
export function libraryNavGroups(
  items: KnowledgeBaseItem[],
  categories: KnowledgeCategory[],
  selfUserId?: number,
): LibraryGroup[] {
  const categoryById = new Map(categories.map(category => [category.id, category]))
  const personal = items.filter(item => item.kind === 'personal' && categoryIdOf(item) === 0)
  const publicRows = items.filter((item) => {
    const categoryId = categoryIdOf(item)
    if (categoryId === 0) return item.kind === 'common'
    const category = categoryById.get(categoryId)
    // Only common+open categories are public; personal/shared never ride a stale require_auth=false.
    return category !== undefined && category.type === 'common' && !category.require_auth
  })
  const authRows = items.filter((item) => {
    const categoryId = categoryIdOf(item)
    if (categoryId === 0) return false
    const category = categoryById.get(categoryId)
    if (category === undefined) return false
    return category.type !== 'common' || category.require_auth
  })
  const subscriptionRows = authRows.filter(item => librarySubscribedByViewer(item, selfUserId))
  const groups: LibraryGroup[] = [
    {
      key: 'personal', label: productText('个人知识库'), create: 'personal',
      createLabel: productText('新建个人知识库'),
      rows: personal,
    },
  ]
  if (publicRows.length !== 0) {
    groups.push({ key: 'public', label: productText('公共知识库'), rows: publicRows })
  }
  groups.push({ key: 'subscription', label: productText('订阅知识库'), rows: subscriptionRows })
  return groups
}

/**
 * Sidebar groups that start collapsed. Only 个人知识库 is expanded on open.
 * @param groups - Current nav groups (public is omitted when empty).
 * @returns Keys to keep collapsed until the user expands them.
 */
export function defaultCollapsedNavGroups(groups: LibraryGroup[]): Set<string> {
  return new Set(groups.map(group => group.key).filter(key => key !== 'personal'))
}

/**
 * Default sidebar selection: first library in the first non-empty nav group.
 * @param items - Libraries the caller may open.
 * @param categories - Administrator-defined categories.
 * @param selfUserId - Optional fallback owner id when ownership annotation is absent.
 * @returns Library id, or undefined when every group is empty.
 */
export function firstNavLibraryId(
  items: KnowledgeBaseItem[],
  categories: KnowledgeCategory[],
  selfUserId?: number,
): number | undefined {
  for (const group of libraryNavGroups(items, categories, selfUserId)) {
    const first = group.rows[0]
    if (first !== undefined) return first.id
  }
  return undefined
}
