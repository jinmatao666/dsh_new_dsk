import { isNoticeTarget } from './Toast.tsx'

/** Includes portaled dropdowns whose trigger belongs to the marketplace.
 * @param target - Pointer event target.
 * @returns Whether the interaction belongs to a marketplace panel or its controls.
 */
export function isMarketInteraction(target: Element): boolean {
  if (target.closest('.dsh-skill-market-panel, .dsh-skill-market-action') !== null || isNoticeTarget(target)) return true
  const owner = target.closest<HTMLElement>('[data-dsh-select-owner]')?.dataset.dshSelectOwner
  return Boolean(owner && document.getElementById(owner)?.closest('.dsh-skill-market-panel'))
}
