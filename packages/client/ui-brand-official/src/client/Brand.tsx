import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  // The sidebar wordmark is already the complete ZJUGIS Harness logo.  Keep
  // this slot empty there so the standalone mark is not rendered twice.
  if (size <= 24) return null

  return (
    <img
      src="/zjugis-mark.png"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', width: `${size}px`, height: 'auto', margin: 0, objectFit: 'contain' }}
      alt=""
      aria-hidden="true"
    />
  )
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }} aria-hidden="true">
      <img
        src="/zjugis-harness.png"
        height={65}
        style={{ display: 'block', width: 'auto', height: 65, maxWidth: '100%', margin: 0, objectFit: 'contain' }}
        alt=""
      />
    </span>
  )
}
