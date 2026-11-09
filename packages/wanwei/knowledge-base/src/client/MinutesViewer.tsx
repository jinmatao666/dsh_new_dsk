import { useEffect, useRef, useState } from 'react'
import { productText } from './locales/product.ts'
import { MarkdownView } from './MarkdownView.tsx'
import { formatRecordingClock } from './recording-minutes.ts'

export interface MinutesViewerProps {
  title: string
  recordedAtLabel: string
  transcript: string
  overview: string
  minutes: string
  /** Object URL for the original audio, when available. */
  audioUrl?: string
  durationMs?: number
}

type MinutesTab = 'overview' | 'minutes'

/**
 * Dual-pane recording-minutes preview: verbatim transcript, 速览/纪要 tabs, and playback.
 */
export function MinutesViewer({
  title, recordedAtLabel, transcript, overview, minutes, audioUrl, durationMs = 0,
}: MinutesViewerProps) {
  const [tab, setTab] = useState<MinutesTab>('overview')
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [knownDurationMs, setKnownDurationMs] = useState(durationMs)
  const [copied, setCopied] = useState<'transcript' | 'side' | undefined>()
  const audioRef = useRef<HTMLAudioElement>(null)
  const copiedTimer = useRef<number>()

  useEffect(() => {
    setKnownDurationMs(durationMs)
    setCurrentMs(0)
    setPlaying(false)
  }, [audioUrl, durationMs])

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
  }, [])

  const togglePlay = async () => {
    const audio = audioRef.current
    if (audio === null || audioUrl === undefined) return
    if (audio.paused) {
      try {
        await audio.play()
        setPlaying(true)
      } catch {
        setPlaying(false)
      }
      return
    }
    audio.pause()
    setPlaying(false)
  }

  const skip = (deltaSeconds: number) => {
    const audio = audioRef.current
    if (audio === null) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || knownDurationMs / 1000, audio.currentTime + deltaSeconds))
    setCurrentMs(audio.currentTime * 1000)
  }

  const copyText = async (value: string, which: 'transcript' | 'side') => {
    const text = value.trim()
    if (text === '') return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(undefined), 1600)
    } catch {
      // Named: clipboard may be denied without a transient status.
    }
  }

  const sideText = tab === 'overview' ? overview : minutes
  const overviewParts = splitOverviewLead(overview)
  const totalMs = knownDurationMs > 0 ? knownDurationMs : Math.max(currentMs, 0)
  const progress = totalMs > 0 ? Math.min(1, currentMs / totalMs) : 0

  return (
    <div className="dsh-knowledge-minutes">
      <div className="dsh-knowledge-minutes-panes">
        <section className="dsh-knowledge-minutes-transcript" aria-label={productText('逐字稿')}>
          <header className="dsh-knowledge-minutes-doc-head">
            <h3>{title}</h3>
            {recordedAtLabel !== '' && <p>{recordedAtLabel}</p>}
          </header>
          <time>00:00</time>
          {transcript.trim() === ''
            ? <p className="dsh-knowledge-empty">{productText('暂无逐字稿')}</p>
            : <article>{transcript}</article>}
          <PaneFooter
            copied={copied === 'transcript'}
            onCopy={() => void copyText(transcript, 'transcript')}
          />
        </section>
        <aside className="dsh-knowledge-minutes-side" aria-label={productText('纪要')}>
          <div className="dsh-knowledge-minutes-tabs" role="tablist" aria-label={productText('纪要')}>
            <button type="button" role="tab" aria-selected={tab === 'overview'}
              onClick={() => setTab('overview')}>{productText('速览')}</button>
            <button type="button" role="tab" aria-selected={tab === 'minutes'}
              onClick={() => setTab('minutes')}>{productText('纪要')}</button>
          </div>
          <div className="dsh-knowledge-minutes-side-body" role="tabpanel">
            {sideText.trim() === ''
              ? <p className="dsh-knowledge-empty">{tab === 'overview' ? productText('暂无速览') : productText('暂无纪要')}</p>
              : tab === 'overview'
                ? <article className="dsh-knowledge-minutes-overview">
                  {overviewParts.lead !== undefined && <h4>{overviewParts.lead}</h4>}
                  {overviewParts.body !== '' && <p>{overviewParts.body}</p>}
                </article>
                : looksLikeMarkdown(sideText)
                  ? <div className="dsh-knowledge-minutes-md"><MarkdownView source={sideText} /></div>
                  : <article>{sideText}</article>}
            <PaneFooter
              copied={copied === 'side'}
              onCopy={() => void copyText(sideText, 'side')}
            />
          </div>
        </aside>
      </div>
      <footer className="dsh-knowledge-minutes-player">
        {audioUrl !== undefined && <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onTimeUpdate={event => setCurrentMs(event.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(event) => {
            const next = event.currentTarget.duration
            if (Number.isFinite(next) && next > 0) setKnownDurationMs(next * 1000)
          }}
          onEnded={() => { setPlaying(false); setCurrentMs(knownDurationMs) }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />}
        <div className="dsh-knowledge-minutes-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="dsh-knowledge-minutes-player-row">
          <time>{formatRecordingClock(currentMs)}</time>
          <div className="dsh-knowledge-minutes-player-controls">
            <button type="button" aria-label={productText('快退15秒')} disabled={audioUrl === undefined}
              onClick={() => skip(-15)}>⟲</button>
            <button type="button" aria-label={playing ? productText('暂停播放') : productText('播放')}
              disabled={audioUrl === undefined} onClick={() => void togglePlay()}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button type="button" aria-label={productText('快进15秒')} disabled={audioUrl === undefined}
              onClick={() => skip(15)}>⟳</button>
          </div>
          <time>{formatRecordingClock(totalMs)}</time>
        </div>
      </footer>
    </div>
  )
}

function PaneFooter({
  copied, onCopy,
}: {
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="dsh-knowledge-minutes-pane-foot">
      <p className="dsh-knowledge-minutes-disclaimer">{productText('内容由AI生成仅供参考')}</p>
      <div className="dsh-knowledge-minutes-pane-actions">
        {copied && <span className="dsh-knowledge-minutes-copied">{productText('已复制')}</span>}
        <button type="button" className="icon-only" aria-label={productText('复制')} title={productText('复制')}
          onClick={onCopy}>
          <CopyIcon />
        </button>
      </div>
    </div>
  )
}

/** Split `00:00 标题` lead line from the overview body for teal styling.
 * @param source - 速览 markdown/plain text.
 */
function splitOverviewLead(source: string): { lead?: string; body: string } {
  const trimmed = source.trim()
  if (trimmed === '') return { body: '' }
  const match = trimmed.match(/^(\d{2}:\d{2}[^\n]*)\n+([\s\S]*)$/u)
  if (match !== null) return { lead: (match[1] ?? '').trim(), body: (match[2] ?? '').trim() }
  if (/^\d{2}:\d{2}\b/u.test(trimmed) && !trimmed.includes('\n')) return { lead: trimmed, body: '' }
  return { body: trimmed }
}

function looksLikeMarkdown(source: string): boolean {
  return /(^|\n)\s*([-*+]|\d+\.)\s+|(^|\n)#{1,6}\s|\*\*[^*]+\*\*/u.test(source)
}

function CopyIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3.5 10.5h-.3A1.2 1.2 0 0 1 2 9.3V3.7A1.2 1.2 0 0 1 3.2 2.5h5.6A1.2 1.2 0 0 1 10 3.7v.3"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
}
