/**
 * Build the desktop skill list from persisted local skills and published server entries.
 * @param localSkills - Skills discovered on the current computer.
 * @param publishedSkills - Skills returned by the management backend, or `null` before it responds.
 * @returns A new catalog containing only those two authoritative sources.
 */
export function buildMarketplaceCatalog<T>(
  localSkills: readonly T[],
  publishedSkills: readonly T[] | null,
): T[] {
  return [...localSkills, ...(publishedSkills ?? [])]
}

/**
 * Keep public browsing separate from owner-only and review-pending local skills.
 * @param skills - Combined local and server-backed skill entries.
 * @returns Only entries confirmed as published by the server.
 */
export function browseMarketplaceCatalog<T extends { marketplacePublished?: boolean }>(skills: readonly T[]): T[] {
  return skills.filter(skill => skill.marketplacePublished === true)
}

/**
 * Read the active package-category names attached to one published skill.
 * @param value - The category relation payload returned by OneAPI.
 * @returns Ordered, unique names of active package categories.
 */
export function publishedSkillCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const category = entry as { type_code?: unknown; name?: unknown; status?: unknown }
    if (category.type_code !== 'skill_package' || category.status === 0) return []
    return typeof category.name === 'string' && category.name.trim() !== '' ? [category.name.trim()] : []
  }))]
}

/**
 * Build category navigation exclusively from the backend-managed list.
 * @param remoteCategories - Ordered category records returned by category management.
 * @returns Ordered, unique category names for marketplace navigation.
 */
export function buildMarketplaceCategories(
  remoteCategories: readonly unknown[] | null,
): string[] {
  const backend = remoteCategories?.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const category = entry as { name?: unknown }
    return typeof category.name === 'string' && category.name.trim() !== '' ? [category.name.trim()] : []
  }) ?? []
  return [...new Set(backend)]
}
