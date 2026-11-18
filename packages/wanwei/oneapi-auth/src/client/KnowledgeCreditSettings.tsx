/** Price editor shared by publication and the desktop credits page. */
import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CreditsSection.module.css'

const zh = {
  title: '知识库积分设置', browse: '浏览积分／文件', question: '问答积分／溯源文件', download: '下载积分／文件',
  hint: '单价适用于本库所有文件，0 表示免费。价格修改仅影响后续使用。', split: '平台 {platform}% · 维护者 {owner}%',
  close: '关闭', save: '保存', saving: '保存中…',
  invalid: '请按各项上限填写积分，最多两位小数。', maximum: '最高 {value} 积分', failed: '读取知识库积分设置失败',
} as const
const t = (key: keyof typeof zh) => zh[key]

/** One library's per-file prices in integer hundredths of a credit. */
export interface KnowledgeCreditPrice { browse_cents: number; question_cents: number; download_cents: number }

/** Owner draft or viewer quote. */
export interface KnowledgeCreditQuote {
  enabled: boolean
  applies: boolean
  configured: boolean
  preview_free: boolean
  platform_percent: number
  price: KnowledgeCreditPrice
  limits?: KnowledgeCreditPrice
}

const defaultLimits = { browse_cents: 1000, question_cents: 1000, download_cents: 1000 }
const fields = [['browse_cents', 'browse'], ['question_cents', 'question'], ['download_cents', 'download']] as const
const asRecord = (value: unknown) => typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
function parsePrice(raw: unknown): KnowledgeCreditPrice {
  const price = asRecord(raw)
  for (const [key] of fields) {
    if (typeof price[key] !== 'number' || !Number.isSafeInteger(price[key]) || Number(price[key]) < 0) throw new Error(t('failed'))
  }
  return {
    browse_cents: Number(price.browse_cents),
    question_cents: Number(price.question_cents),
    download_cents: Number(price.download_cents),
  }
}

/** Decode a server-owned quote before displaying or accepting a charge.
 * @param raw - Authenticated OneAPI response data.
 * @returns Validated quote and price fields.
 */
export function parseKnowledgeCreditQuote(raw: unknown): KnowledgeCreditQuote {
  const value = asRecord(raw)
  if (typeof value.enabled !== 'boolean' || typeof value.applies !== 'boolean' || typeof value.configured !== 'boolean' ||
    typeof value.preview_free !== 'boolean' || !Number.isInteger(value.platform_percent) ||
    Number(value.platform_percent) < 0 || Number(value.platform_percent) > 100) throw new Error(t('failed'))
  return { enabled: value.enabled, applies: value.applies, configured: value.configured, preview_free: value.preview_free,
    platform_percent: Number(value.platform_percent), price: parsePrice(value.price),
    ...(value.limits === undefined ? {} : { limits: parsePrice(value.limits) }) }
}

/** Edit and save the three prices together in the caller's dialog.
 * @param props - Existing prices, platform percentage, save operation and optional cancel action.
 * @returns A form that reports validation and save failures in place.
 */
export function KnowledgeCreditPriceForm({ price, limits = defaultLimits, platform, onSave, onCancel }: {
  price: KnowledgeCreditPrice
  limits?: KnowledgeCreditPrice | undefined
  platform: number
  onSave: (next: KnowledgeCreditPrice) => Promise<void>
  onCancel?: () => void
}) {
  const [values, setValues] = useState(() => fields.map(([key]) => (price[key] / 100).toFixed(2)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return <form className={css.knowledgePrices} onSubmit={async (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (saving) return
    const invalid = fields.some(([key], index) => {
      const value = values[index]?.trim() ?? ''
      return !/^\d+(?:\.\d{1,2})?$/.test(value) || Math.round(Number(value) * 100) > limits[key]
    })
    if (invalid) { setError(t('invalid')); return }
    setSaving(true); setError('')
    try {
      await onSave({
        browse_cents: Math.round(Number(values[0]) * 100),
        question_cents: Math.round(Number(values[1]) * 100),
        download_cents: Math.round(Number(values[2]) * 100),
      })
    }
    catch (cause) { setError(String(cause)) }
    finally { setSaving(false) }
  }}>
    <p>{t('hint')}</p>
    {fields.map(([key, label], index) => <label key={key}><span>{t(label)}<small>{t('maximum').replace('{value}', String(limits[key] / 100))}</small></span>
      <input inputMode="decimal" required disabled={saving} value={values[index]}
        onChange={event => setValues(values.map((value, i) => i === index ? event.target.value : value))} />
    </label>)}
    <p>{t('split').replace('{platform}', String(platform)).replace('{owner}', String(100 - platform))}</p>
    {error !== '' && <p role="alert">{error}</p>}
    <div className={css.headingActions}>
      {onCancel !== undefined && <button type="button" className={css.secondary} disabled={saving} onClick={onCancel}>{t('close')}</button>}
      <button type="submit" className={css.primary} disabled={saving}>{saving ? t('saving') : t('save')}</button>
    </div>
  </form>
}

type PriceItem = KnowledgeCreditPrice & { id: number; name: string }

/** Show owner pricing for personal libraries approved for subscription.
 * @param props - Authenticated request dispatcher and credits page refresh revision.
 * @returns A settings entry and pricing dialog when the owner has eligible libraries.
 */
export function KnowledgeCreditSettings({ request, revision }: {
  request: (operation: string, payload?: object) => Promise<unknown>
  revision: number
}) {
  const [catalog, setCatalog] = useState<{ platform: number; limits: KnowledgeCreditPrice; items: PriceItem[] }>()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PriceItem>()
  useEffect(() => {
    let live = true
    void request('credit-prices').then((raw) => {
      if (!live) return
      const value = asRecord(raw)
      if (value.enabled !== true) { setCatalog(undefined); return }
      if (!Array.isArray(value.items) || !Number.isInteger(value.platform_percent)) throw new Error(t('failed'))
      const items = value.items.map((rawItem) => {
        const item = asRecord(rawItem)
        if (typeof item.id !== 'number' || typeof item.name !== 'string') throw new Error(t('failed'))
        return { ...parsePrice(item), id: item.id, name: item.name }
      })
      setCatalog({
        platform: Number(value.platform_percent), limits: value.limits === undefined ? defaultLimits : parsePrice(value.limits), items,
      })
    }).catch(() => { if (live) setCatalog(undefined) })
    return () => { live = false }
  }, [request, revision])
  if (catalog === undefined || catalog.items.length === 0) return null
  return <>
    <button type="button" className={css.secondary} onClick={() => setOpen(true)}>{t('title')}</button>
    {open && editing === undefined && <Modal open title={t('title')} closeLabel={t('close')} onClose={() => setOpen(false)}>
      <div className={css.knowledgePrices}>
        {catalog.items.map(item => <button type="button" className={css.secondary} key={item.id} onClick={() => setEditing(item)}>{item.name}</button>)}
      </div>
    </Modal>}
    {editing !== undefined && <Modal open title={t('title')} closeLabel={t('close')} onClose={() => setEditing(undefined)}>
      <KnowledgeCreditPriceForm price={editing} limits={catalog.limits} platform={catalog.platform} onSave={async (price) => {
        await request('save-credit-price', { id: editing.id, ...price })
        setCatalog(current => current && {
          ...current,
          items: current.items.map(item => item.id === editing.id ? { ...item, ...price } : item),
        })
        setEditing(undefined)
      }} />
    </Modal>}
  </>
}
