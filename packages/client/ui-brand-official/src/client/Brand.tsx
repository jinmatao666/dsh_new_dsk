import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return (
    <img
      src="/brand-mark.svg"
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
        src="/brand-wordmark.svg"
        height={36}
        style={{ display: 'block', width: 'auto', height: 36, maxWidth: '100%', margin: 0, objectFit: 'contain' }}
        alt=""
      />
    </span>
  )
}

/** Render the horizontal lockup in the empty workspace hero. */
export function OfficialHeroBrand() {
  return (
    <img
      src="/brand-wordmark.svg"
      width={244}
      height={61}
      style={{ display: 'block', width: 'min(244px, 52vw)', height: 'auto', margin: 0, objectFit: 'contain' }}
      alt="万维 Buddy"
    />
  )
}
