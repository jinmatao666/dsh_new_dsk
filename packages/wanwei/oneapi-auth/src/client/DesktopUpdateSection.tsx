/** Dedicated version settings and shell-level download progress. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdateController } from './desktop-update-controller.ts'
import css from './DesktopUpdateSection.module.css'

interface UpdateProps extends PropsLocale<'wanwei.auth'> { updates: DesktopUpdateController }

function UpdateIcon({ download = false }: { download?: boolean }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {download ? <path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" />
      : <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11.6-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17" /></>}
  </svg>
}

/** Compact branded version card, checking preference and explicit native check action.
 * @param props - Shared plugin-owned monitor and localized copy.
 * @returns Version settings; no executable controls in a standalone browser.
 */
export function DesktopUpdateSection({ t, updates }: UpdateProps) {
  const { snapshot: view, pending, error } = useSyncExternalStore(updates.subscribe, updates.getSnapshot)
  const [checked, setChecked] = useState(false)
  if (!updates.available) return null
  const active = view !== undefined && ['checking', 'downloading', 'installing'].includes(view.phase)
  const downloading = view?.phase === 'downloading'
  return <section className={css.section} aria-label={t('updatesTitle')}>
    <h1>{t('updatesNav')}</h1><p className={css.intro}>{t('updatesIntro')}</p>
    <div className={css.versionCard}>
      <span className={css.versionIcon}><img src="/brand-mark.svg" width={32} height={32} alt="" aria-hidden="true" /></span>
      <div className={css.versionInfo}><span>{t('productName')}</span>
        <div className={css.versionLine}><strong>{view?.currentVersion ?? '—'}</strong><small>{t('updatesVersionLabel')}</small></div></div>
      <div className={css.versionMeta}>
        {view?.currentOfficial === false ? <span className={css.testingBadge}>{t('updatesGrayTesting')}</span> : null}
        {view?.currentOfficial === true ? <span className={css.officialBadge}>{t('updatesOfficialRelease')}</span> : null}
        <span className={css.desktopBadge}>{t('updatesDesktop')}</span>
      </div>
    </div>
    <div className={css.preference}>
      <div><h2>{t('updatesAutomatic')}</h2><p>{t('updatesSchedule')}</p></div>
      <button type="button" role="switch" aria-label={t('updatesAutomatic')} aria-checked={view?.automatic ?? false}
        className={css.switch} disabled={pending || view === undefined || !view.configured}
        onClick={() => { void updates.setAutomatic(!view?.automatic) }}><span /></button>
    </div>
    <div className={css.checkRow}>
      <div><h2>{t('updatesManual')}</h2><p>{t('updatesManualHint')}</p></div>
      <button type="button" className={css.primary} disabled={pending || active || view?.configured !== true}
        onClick={() => { setChecked(true); void updates.check() }}><UpdateIcon />{active || pending ? t('updatesWorking') : t('updatesCheck')}</button>
    </div>
    {downloading ? <button type="button" className={css.textButton} onClick={() => { updates.showProgress(true) }}>
      {t('updatesShowProgress')}</button> : null}
    {view?.configured === false ? <p className={css.notice}>{t('updatesUnavailable')}</p> : null}
    {checked && !pending && view?.message && !downloading ? <p role="status" className={css.notice}>{view.message}</p> : null}
    {error === undefined ? null : <p role="alert" className={css.error}>{error}</p>}
  </section>
}

/** Show progress and persisted completion notes independently of settings navigation.
 * @param props - Shared monitor and localized dialog copy.
 * @returns Body-portaled top-layer dialogs for native update progress or unread completion notes.
 */
export function DesktopUpdateOverlay({ t, updates }: UpdateProps) {
  const { snapshot: view, progressOpen, error } = useSyncExternalStore(updates.subscribe, updates.getSnapshot)
  return <>
    <CompletedUpdateDialog t={t} updates={updates} />
    <DownloadUpdateDialog t={t} updates={updates} view={view}
      progressOpen={progressOpen && (view?.completed === undefined || view.completed === null || view.completed.dismissed)} error={error} />
  </>
}

function CompletedUpdateDialog({ t, updates }: UpdateProps) {
  const { snapshot: view, pending, error } = useSyncExternalStore(updates.subscribe, updates.getSnapshot)
  const completed = view?.completed
  const dialog = useRef<HTMLDialogElement>(null)
  const visible = completed !== undefined && completed !== null && !completed.dismissed
  useEffect(() => {
    const element = dialog.current
    if (visible && element !== null && !element.open) element.showModal()
  }, [visible])
  if (!visible) return null
  const close = () => { void updates.dismissCompleted() }
  return createPortal(<dialog ref={dialog} className={`${css.dialog} ${css.releaseDialog}`}
    aria-labelledby="wanwei-update-completed-title" aria-describedby="wanwei-update-completed-intro"
    onCancel={(event) => { event.preventDefault(); close() }}>
    <div className={css.dialogHeader}>
      <span className={css.versionIcon}><img src="/brand-mark.svg" width={32} height={32} alt="" aria-hidden="true" /></span>
      <button type="button" className={css.close} disabled={pending} aria-label={t('supportClose')} onClick={close}>×</button>
    </div>
    <h2 id="wanwei-update-completed-title">{t('updatesCompletedTitle')}</h2>
    <p id="wanwei-update-completed-intro" className={css.dialogHint}>{t('updatesCompletedVersion')} <strong>{completed.version}</strong></p>
    <section className={css.releaseNotes} aria-label={t('updatesReleaseNotes')}>
      <h3>{t('updatesReleaseNotes')}</h3>
      <p>{completed.notes.trim() || t('updatesNoReleaseNotes')}</p>
    </section>
    {error === undefined ? null : <p role="alert" className={css.error}>{error}</p>}
    <div className={`${css.dialogFooter} ${css.releaseFooter}`}>
      <button type="button" className={css.primary} disabled={pending} onClick={close}>{t('updatesCompletedClose')}</button>
    </div>
  </dialog>, document.body)
}

function DownloadUpdateDialog({ t, updates, view, progressOpen, error }: UpdateProps & {
  view: ReturnType<DesktopUpdateController['getSnapshot']>['snapshot']
  progressOpen: boolean
  error: string | undefined
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (progressOpen && element !== null && !element.open) element.showModal()
  }, [progressOpen])
  if (!progressOpen || view === undefined) return null
  const installing = view.phase === 'installing'
  const downloading = view.phase === 'downloading'
  const percent = view.total > 0 ? Math.min(100, Math.round(view.received / view.total * 100)) : undefined
  const size = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`
  return createPortal(<dialog ref={dialog} className={css.dialog} aria-label={t('updatesProgressTitle')}
    onCancel={(event) => { event.preventDefault(); if (!installing) updates.showProgress(false) }}>
    <div className={css.dialogHeader}><span className={css.downloadIcon}><UpdateIcon download /></span>
      <button type="button" className={css.close} disabled={installing} aria-label={t('updatesHide')}
        onClick={() => { updates.showProgress(false) }}>×</button></div>
    <h2>{installing ? t('updatesInstalling') : downloading ? t('updatesDownloading') : t('updatesProgressTitle')}</h2>
    <p className={css.dialogHint}>{downloading ? t('updatesDownloadHint') : installing ? t('updatesInstallHint') : t('updatesSafety')}</p>
    {downloading ? <>
      <div className={css.progressMeta}><span>{t('updatesDownload')}</span><strong>{percent === undefined ? '—' : `${percent}%`}</strong></div>
      <progress className={css.progress} aria-label={t('updatesDownload')}
        {...(view.total > 0 ? { value: Math.min(view.received, view.total), max: view.total } : {})} />
      <p className={css.bytes}>{size(view.received)}{view.total > 0 ? ` / ${size(view.total)}` : ''}</p>
    </> : <p role="status" className={css.notice}>{view.message}</p>}
    {error === undefined ? null : <p role="alert" className={css.error}>{error}</p>}
    <div className={css.dialogFooter}><span>{installing ? t('updatesInstallHint') : t('updatesConfirmationHint')}</span>
      <button type="button" className={css.secondary} disabled={installing} onClick={() => { updates.showProgress(false) }}>
        {downloading ? t('updatesBackground') : t('supportClose')}</button></div>
  </dialog>, document.body)
}
