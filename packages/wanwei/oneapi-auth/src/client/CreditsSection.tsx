import { useEffect, useState } from 'react'
import { Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthView } from './controller.ts'
import css from './CreditsSection.module.css'

type Checkin = { enabled: boolean; can_claim: boolean; amount: number; interval_days: number; next_date: string }
type History = {
  balance: number
  total: number
  items: { id: string; time: number; name: string; credits: number; balance: number | null }[]
}
/** Host-backed operations shared by the credits page and sidebar shortcut. */
export interface CreditsInjected {
  hooks: { auth: HostObservable<AuthView> }
  requestCredits: (operation: string, page?: number, filter?: string) => Promise<unknown>
}
const filterOptions = [['all', '全部'], ['earned', '获得'], ['spent', '消耗']] as const
const points = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const changed = () => { window.dispatchEvent(new Event('wanwei:credits-changed')) }

/** A shortcut appears only while the authenticated user can claim a configured reward. */
export function CheckinShortcut({ useAuth, requestCredits, wide }: PropsRuntime<'settings.shortcut'> & InjectFace<CreditsInjected>) {
  const auth = useAuth(value => value)
  const [status, setStatus] = useState<Checkin>()
  useEffect(() => {
    setStatus(undefined)
    if (auth.state !== 'authenticated') return
    let live = true, revision = 0
    const refresh = () => {
      const current = ++revision
      void requestCredits('status').then((value) => { if (live && current === revision) setStatus(value as Checkin) }).catch(() => { if (live && current === revision) setStatus(undefined) })
    }
    refresh()
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh); window.addEventListener('wanwei:credits-changed', refresh)
    return () => { live = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('wanwei:credits-changed', refresh) }
  }, [auth, requestCredits])
  if (!wide || !status?.enabled || !status.can_claim) return null
  return <button className={css.shortcut} type="button"
    onClick={() => { window.dispatchEvent(new CustomEvent('dsh:open-settings-section', { detail: 'wanwei-credits' })) }}>签到领积分</button>
}

/** Balance, explicit check-in and paginated personal credit history. */
export function CreditsSection({ useAuth, requestCredits }: PropsRuntime<'settings.section'> & InjectFace<CreditsInjected>) {
  const auth = useAuth(value => value)
  const [status, setStatus] = useState<Checkin>()
  const [history, setHistory] = useState<History>()
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState('all')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setHistory(undefined); setStatus(undefined); setError(''); setLoading(true)
    if (auth.state !== 'authenticated') { setLoading(false); return }
    let live = true
    void Promise.all([requestCredits('status'), requestCredits('history', page, filter)]).then(([state, data]) => {
      if (live) { setStatus(state as Checkin); setHistory(data as History) }
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [auth, requestCredits, page, filter, revision])
  const claim = async () => {
    if (busy) return
    setBusy(true)
    try {
      const next = await requestCredits('claim') as Checkin
      setStatus(next); changed(); setNotice('签到成功，积分已到账')
      setRevision(value => value + 1)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); changed() }
    finally { setBusy(false) }
  }
  return <section className={css.section}>
    <header className={css.heading}>
      <div>
        <h1>积分与用量</h1>
        <p>查看积分余额、签到奖励和使用记录。</p>
      </div>
      <button className={css.secondary} disabled={loading || busy}
        onClick={() => { changed(); setRevision(value => value + 1) }}>刷新</button>
    </header>
    <div className={css.balance}>
      <span>可用积分</span>
      <strong>{history ? points(history.balance) : '—'}</strong>
      <span>按实际使用结算，支持小数积分</span>
    </div>
    {status?.enabled && <div className={css.checkin}>
      <div>
        <h2>签到赠送</h2>
        <p>每 {status.interval_days} 天可领取 {points(status.amount)} 积分，未签到不补发。</p>
        {!status.can_claim && status.next_date && <p>下次可领取：{status.next_date}（北京时间）</p>}</div>
      <button className={css.primary} disabled={busy || !status.can_claim}
        onClick={() => { void claim() }}>{busy ? '领取中…' : status.can_claim ? '立即签到' : '本周期已签到'}</button>
    </div>}
    <div className={css.heading}>
      <h2>积分明细</h2>
      <div className={css.filters}>{filterOptions.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} disabled={busy}
        onClick={() => { setPage(0); setFilter(key) }}>{label}</button>)}</div>
    </div>
    <div className={css.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>事项</th>
            <th>积分变动</th>
            <th>变动后余额</th>
          </tr>
        </thead>
        <tbody>{history?.items.map(row => <tr key={row.id}>
          <td>{new Date(row.time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</td>
          <td>{row.name}</td>
          <td className={row.credits > 0 ? css.earned : undefined}>{row.credits > 0 ? '+' : ''}{points(row.credits)}</td>
          <td>{row.balance === null ? '—' : points(row.balance)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {loading ? <p className={css.muted}>正在加载…</p> : history?.items.length === 0 ? <p className={css.muted}>暂无积分记录</p> : null}
    <footer className={css.pagination}>
      <span>时间按北京时间显示；历史记录未保存的余额显示为“—”。</span>
      <button className={css.secondary} disabled={loading || busy || page === 0}
        onClick={() => { setPage(value => value - 1) }}>上一页</button>
      <span>{page + 1}</span>
      <button className={css.secondary}
        disabled={loading || busy || !history || (page + 1) * 20 >= history.total}
        onClick={() => { setPage(value => value + 1) }}>下一页</button>
    </footer>
    {notice && <Toast text={notice} onDone={() => { setNotice('') }} />}
    <Modal open={!!error} title="积分服务提示" closeLabel="关闭" onClose={() => { setError('') }}>
      <p>{error}</p>
      <button className={css.primary} onClick={() => { setError(''); setRevision(value => value + 1) }}>重新加载</button>
    </Modal>
  </section>
}
