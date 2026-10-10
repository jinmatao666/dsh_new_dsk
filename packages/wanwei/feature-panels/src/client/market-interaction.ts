import { isNoticeTarget } from './Toast.tsx'

/** Includes owned dropdowns and layout-only gestures that must preserve the panel.
 * @param target - Pointer event target.
 * @returns Whether the pointer interaction must leave the current panel open.
 */
export function isMarketInteraction(target: Element): boolean {
  // AppFrame's column handles change geometry, not the selected feature or session.
  if (target.closest('[data-side="sidebar"], [data-side="details"]') !== null) return true
  if (target.closest('.dsh-skill-market-panel, .dsh-skill-market-action') !== null || isNoticeTarget(target)) return true
  const owner = target.closest<HTMLElement>('[data-dsh-select-owner]')?.dataset.dshSelectOwner
  return Boolean(owner && document.getElementById(owner)?.closest('.dsh-skill-market-panel'))
}
