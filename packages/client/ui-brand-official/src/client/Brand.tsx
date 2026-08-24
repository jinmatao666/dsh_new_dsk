import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  const sidebarSize = size <= 24 ? 30 : size
  return (
    <img
      src="/zjugis-mark.png"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', width: `${sidebarSize}px`, height: 'auto', margin: 0, objectFit: 'contain' }}
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
        height={30}
        style={{ display: 'block', width: 'auto', height: 30, maxWidth: '100%', margin: 0, objectFit: 'contain' }}
        alt=""
      />
    </span>
  )
}
