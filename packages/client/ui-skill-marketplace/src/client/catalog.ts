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
