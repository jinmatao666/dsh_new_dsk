import { accountIcons } from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'

/** Compact per-use price; free skills and disabled accounting have no label. */
export function SkillPrice({ credits, enabled }: { credits: number | undefined; enabled: boolean }) {
  if (!enabled || credits === undefined || !Number.isSafeInteger(credits) || credits <= 0) return null
  return <span className="dsh-skill-price">
    <span>{credits.toLocaleString()}</span>
    <span className="dsh-skill-price-icon" aria-hidden="true" style={{ maskImage: `url("${accountIcons.coins}")` }} />
  </span>
}
