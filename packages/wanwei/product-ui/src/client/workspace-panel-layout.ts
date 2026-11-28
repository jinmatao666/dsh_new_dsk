/** Fit file panes while keeping the conversation readable at each window width.
 * @param available - Width after the actual navigation sidebar.
 * @param viewport - Whole viewport width for the narrow-window drawer.
 * @param preview - Whether a document is selected.
 * @param preferred - User's preferred document width.
 * @returns Panel geometry; drawers reserve no conversation space.
 */
export function workspacePanelLayout(available: number, viewport: number, preview: boolean, preferred: number): {
  mode: 'columns' | 'preview' | 'tree' | 'overlay'
  width: number
  tree: number
  reserved: number
} {
  if (available < 880) {
    const width = Math.min(preview ? 740 : 360, available - 16, viewport - 24)
    return { mode: 'overlay', width, tree: preview ? 0 : width, reserved: 0 }
  }
  if (!preview) return { mode: 'tree', width: 240, tree: 240, reserved: 240 }
  if (available < 1180) {
    const width = Math.min(preferred, available - 600)
    return { mode: 'preview', width, tree: 0, reserved: width }
  }
  const width = Math.min(preferred, available - 600 - 240) + 240
  return { mode: 'columns', width, tree: 240, reserved: width }
}
