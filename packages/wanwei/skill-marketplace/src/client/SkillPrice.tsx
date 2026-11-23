import { productText } from './locales/product.ts'
import { CreditCoinIcon } from '@deepseek-ai/dsh-wanwei-feature-panels/client'

/** Compact per-use price; free skills and disabled accounting have no label. */
export function SkillPrice({ credits, points, enabled }: {
  credits: number | undefined
  points?: unknown
  enabled: boolean
}) {
  if (!enabled) return null
  const prices = Array.isArray(points) ? points : [{ credits, name: productText('技能调用') }]
  return <>{prices.map((point: unknown, index) => {
    if (typeof point !== 'object' || point === null) return null
    const { credits: amount, name } = point as Record<string, unknown>
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || typeof name !== 'string') return null
    return <span className="dsh-skill-price" title={name} key={index}>{productText('技能')}：{amount.toLocaleString(undefined, { maximumFractionDigits: 20 })}<CreditCoinIcon className="dsh-skill-price-icon" /></span>
  })}</>
}
