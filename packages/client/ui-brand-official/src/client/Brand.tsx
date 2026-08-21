import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  const sidebarSize = size <= 24 ? 40 : size
  return (
    <img
      src="/wanwei-mark.png"
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: '100%' }} aria-hidden="true">
      <img
        src="/wanwei-wordmark.png"
        height={38}
        style={{ display: 'block', width: 'auto', height: 38, maxWidth: '100%', margin: 0, objectFit: 'contain' }}
        alt=""
      />
      <img
        src="/wanwei-harness.png"
        height={58}
        style={{
          display: 'block',
          width: 'auto',
          height: 58,
          maxWidth: '40%',
          margin: 0,
          objectFit: 'contain',
          transform: 'translateX(-16px)',
        }}
        alt=""
      />
    </span>
  )
}
