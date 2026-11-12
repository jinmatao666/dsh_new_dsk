import { KnowledgeCreditPriceForm, type KnowledgeCreditPrice, type KnowledgeCreditQuote } from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import { useEffect, useState } from 'react'
import { productText as t } from './locales/product.ts'

/** Latest saved publication decision belonging to a library owner. */
export interface PublicationRequest {
  id: number
  status: 'pending' | 'approved' | 'rejected'
  target: 'public' | 'subscription'
  review_note: string
}

/** Owner-only publication endpoints. */
export interface PublicationApi {
  /** Read saved prices and the viewer's rolling preview entitlement. */
  creditPrice(id: number, documentId?: string): Promise<KnowledgeCreditQuote>
  /** Save all per-file prices for an owned library. */
  saveCreditPrice(id: number, price: KnowledgeCreditPrice): Promise<void>
  /** Read edition availability, the saved request.
   * @param id - Owned library id.
   * @returns Deployment availability and latest request.
   */
  publication(id: number): Promise<{ enabled: boolean; application: PublicationRequest | null }>
  /** Queue a personal library without publishing it.
   * @param id - Owned personal library id.
   * @param target - Requested public or subscription sharing scope.
   * @param reason - Owner's application note, at most 500 characters.
   * @returns Saved pending request.
   */
  applyPublication(id: number, target: 'public' | 'subscription', reason: string): Promise<PublicationRequest>
}

/** Personal-library publication actions with persisted pending and rejected states.
 * @param props - Library and authenticated publication operations.
 * @returns Owner actions and the publication request dialog.
 */
export function PublicationControls({ id, api, scope }: { id: number; api: PublicationApi; scope: '' | 'public' | 'subscription' }) {
  const [info, setInfo] = useState<{ enabled: boolean; application: PublicationRequest | null }>()
  const [pricing, setPricing] = useState<KnowledgeCreditQuote>()
  const [target, setTarget] = useState<'public' | 'subscription'>()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void api.publication(id).then((value) => { if (active) setInfo(value) }).catch((cause) => {
      if (active) setError(`${t('读取发布状态失败')}：${String(cause)}`)
    })
    return () => { active = false }
  }, [id, api])
  const application = info?.application
  return <div className="dsh-knowledge-publication">
    {error && <p role="alert">{error}</p>}
    {info?.enabled && <>
      {scope !== '' ? <span className="dsh-knowledge-publication-saved">{t(scope === 'public' ? '已发布为公共库' : '已发布为订阅库')}</span>
        : application?.status === 'pending' ? <span className="dsh-knowledge-publication-pending" role="status">{t('发布申请待管理员审核')}</span> : <>
          {application?.status === 'rejected' && <span className="dsh-knowledge-publication-rejected" title={application.review_note}>{t('发布申请已驳回')}：{application.review_note}</span>}
          <details className="dsh-knowledge-publish-menu">
            <summary aria-label={t('发布知识库')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6" /></svg>
              {t('发布')}
              <svg className="dsh-knowledge-publish-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </summary>
            <div className="dsh-knowledge-publish-options">
              {(['public', 'subscription'] as const).map(value => <button key={value} type="button" onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open')
                if (value === 'public') { setTarget(value); return }
                setError('')
                void api.creditPrice(id).then((quote) => {
                  if (quote.enabled && !quote.configured) setPricing(quote)
                  else setTarget(value)
                }).catch(cause => setError(`${t('读取发布状态失败')}：${String(cause)}`))
              }}><span className={`dsh-knowledge-publish-option-icon ${value}`}>{value === 'public' ? '◎' : '◇'}</span><span><strong>{t(value === 'public' ? '转为公共知识库' : '转为订阅知识库')}</strong><small>{t(value === 'public' ? '审核后向所有用户开放' : '审核后由用户申请订阅')}</small></span></button>)}
            </div>
          </details>
        </>}
    </>}
    {pricing !== undefined && <div className="dsh-knowledge-modal-backdrop">
      <div className="dsh-knowledge-modal" role="dialog" aria-modal="true" aria-label={t('知识库积分设置')}>
        <h3>{t('知识库积分设置')}</h3>
        <KnowledgeCreditPriceForm price={pricing.price} platform={pricing.platform_percent}
          onCancel={() => setPricing(undefined)} onSave={async (price) => {
            await api.saveCreditPrice(id, price)
            setPricing(undefined)
            setTarget('subscription')
          }} />
      </div>
    </div>}
    {target !== undefined && <div className="dsh-knowledge-modal-backdrop">
      <form className="dsh-knowledge-modal" role="dialog" aria-modal="true" aria-label={t('申请发布知识库')}
        onSubmit={async (event) => {
          event.preventDefault()
          if (saving) return
          setSaving(true); setError('')
          try {
            const saved = await api.applyPublication(id, target, reason)
            setInfo({ enabled: true, application: saved }); setTarget(undefined); setReason('')
          } catch (cause) { setError(`${t('提交发布申请失败')}：${String(cause)}`) }
          finally { setSaving(false) }
        }}>
        <h3>{t(target === 'public' ? '转为公共知识库' : '转为订阅知识库')}</h3>
        <p>{t(target === 'public'
          ? '审核通过后，整个知识库及后续新增内容对所有用户可见。'
          : '审核通过后，知识库将进入广场，其他用户申请订阅并通过审核后可使用。')}</p>
        <p>{t('审核通过前仍为个人知识库。请确认其中没有不适合分享的资料。')}</p>
        <div className="dsh-knowledge-publication-destination"><span>{t('发布至')}</span><strong>{t(target === 'public' ? '公共知识库' : '订阅知识库')}</strong><small>{t('个人知识库中仍保留原库，内容同步更新。')}</small></div>
        <label>{t('申请说明')}<textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" disabled={saving} onClick={() => setTarget(undefined)}>{t('取消')}</button>
          <button type="submit" disabled={saving}>{t('提交审核')}</button></footer>
      </form>
    </div>}
  </div>
}
