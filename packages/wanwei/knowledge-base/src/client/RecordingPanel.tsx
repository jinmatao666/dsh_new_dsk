import { useEffect, useRef, useState } from 'react'
import { productText } from './locales/product.ts'
import {
  RECORDING_MAX_MS,
  buildRecordingWavFile,
  formatRecordingClock,
  pickRecorderMimeType,
  recordingMinutesStem,
} from './recording-minutes.ts'

/** Minimal Web Speech API surface used for optional live captions. */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly 0?: { transcript: string }
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: Event) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** Outcome handed to KnowledgePage after the user confirms a recording. */
export interface RecordingMinutesCapture {
  /** Mono 16 kHz WAV for Host ASR + knowledge playback. */
  audio: File
  /** Shared `录音纪要_…` stem without extension. */
  stem: string
  /** Optional Web Speech live caption used when Host ASR is empty. */
  liveTranscript: string
  durationMs: number
}

interface RecordingPanelProps {
  /** Called when the user cancels or closes without saving. */
  onCancel: () => void
  /** Called after a confirmed recording is packaged into uploadable files. */
  onComplete: (capture: RecordingMinutesCapture) => void
}

type RecorderPhase = 'idle' | 'recording' | 'paused' | 'stopping'

/**
 * Floating microphone recorder for personal-library 录音纪要.
 * Uses MediaRecorder; optional Web Speech API fills a live transcript for the companion markdown.
 */
export function RecordingPanel({ onCancel, onComplete }: RecordingPanelProps) {
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder>()
  const streamRef = useRef<MediaStream>()
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef('')
  const startedAtRef = useRef(0)
  const accumulatedRef = useRef(0)
  const tickRef = useRef<number>()
  const recognitionRef = useRef<SpeechRecognitionLike>()
  const transcriptRef = useRef('')

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = undefined
  }

  const stopRecognition = () => {
    const recognition = recognitionRef.current
    recognitionRef.current = undefined
    if (recognition === undefined) return
    try {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.stop()
    } catch {
      // Named: stop after the engine already ended is a no-op.
    }
  }

  const clearTick = () => {
    if (tickRef.current !== undefined) {
      window.clearInterval(tickRef.current)
      tickRef.current = undefined
    }
  }

  useEffect(() => () => {
    clearTick()
    stopRecognition()
    const recorder = mediaRecorderRef.current
    if (recorder !== undefined && recorder.state !== 'inactive') {
      try { recorder.stop() } catch {
        // Named: unmount during stop races the native recorder.
      }
    }
    stopTracks()
  }, [])

  const startRecognition = () => {
    const SpeechRecognitionCtor = (window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }).SpeechRecognition
      ?? (window as Window & { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition
    if (SpeechRecognitionCtor === undefined) return
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let finalText = transcriptRef.current
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result === undefined) continue
        const piece = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += piece
        else interim += piece
      }
      transcriptRef.current = finalText
      setLiveTranscript(`${finalText}${interim}`.trim())
    }
    recognition.onerror = () => {
      // Named: speech recognition is best-effort; recording continues without it.
    }
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      if (mediaRecorderRef.current?.state === 'recording') {
        try { recognition.start() } catch {
          // Named: restart after a browser-forced end while still recording.
        }
      }
    }
    recognitionRef.current = recognition
    try { recognition.start() } catch {
      recognitionRef.current = undefined
    }
  }

  const beginTick = () => {
    clearTick()
    tickRef.current = window.setInterval(() => {
      const running = Date.now() - startedAtRef.current
      const total = accumulatedRef.current + running
      setElapsedMs(total)
      if (total >= RECORDING_MAX_MS) {
        void finishRecording(true)
      }
    }, 200)
  }

  const startRecording = async () => {
    setError('')
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      setError(productText('当前环境无法使用麦克风'))
      return
    }
    const mimeType = pickRecorderMimeType()
    if (mimeType === '' && typeof MediaRecorder === 'undefined') {
      setError(productText('当前环境无法录音'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = mimeType === ''
        ? new MediaRecorder(stream)
        : new MediaRecorder(stream, { mimeType })
      mimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm'
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      mediaRecorderRef.current = recorder
      accumulatedRef.current = 0
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      transcriptRef.current = ''
      setLiveTranscript('')
      recorder.start(1000)
      setPhase('recording')
      beginTick()
      startRecognition()
    } catch {
      stopTracks()
      setError(productText('无法访问麦克风，请在系统设置中允许后重试'))
    }
  }

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder === undefined || recorder.state !== 'recording') return
    recorder.pause()
    accumulatedRef.current += Date.now() - startedAtRef.current
    clearTick()
    setPhase('paused')
    stopRecognition()
  }

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder === undefined || recorder.state !== 'paused') return
    recorder.resume()
    startedAtRef.current = Date.now()
    setPhase('recording')
    beginTick()
    startRecognition()
  }

  const discardRecording = () => {
    clearTick()
    stopRecognition()
    const recorder = mediaRecorderRef.current
    if (recorder !== undefined && recorder.state !== 'inactive') {
      try { recorder.stop() } catch {
        // Named: discard after a native failure is still a close.
      }
    }
    mediaRecorderRef.current = undefined
    chunksRef.current = []
    stopTracks()
    setPhase('idle')
    setElapsedMs(0)
    setLiveTranscript('')
    transcriptRef.current = ''
    onCancel()
  }

  const finishRecording = (autoStop = false) => {
    const recorder = mediaRecorderRef.current
    if (recorder === undefined) {
      onCancel()
      return
    }
    if (phase === 'stopping') return
    setPhase('stopping')
    clearTick()
    stopRecognition()
    if (recorder.state === 'recording') {
      accumulatedRef.current += Date.now() - startedAtRef.current
    }
    const durationMs = Math.min(RECORDING_MAX_MS, accumulatedRef.current || elapsedMs)
    setElapsedMs(durationMs)
    recorder.onstop = () => {
      stopTracks()
      mediaRecorderRef.current = undefined
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' })
      chunksRef.current = []
      if (blob.size === 0) {
        setError(productText('录音为空，请重新录制'))
        setPhase('idle')
        return
      }
      if (!autoStop && durationMs < 1000) {
        setError(productText('录音时间过短，请继续录制'))
        setPhase('idle')
        return
      }
      const stem = recordingMinutesStem()
      const transcript = transcriptRef.current.trim() || liveTranscript.trim()
      void buildRecordingWavFile(blob, stem).then((audio) => {
        onComplete({ audio, stem, liveTranscript: transcript, durationMs })
      }).catch(() => {
        setError(productText('当前环境无法转换录音格式'))
        setPhase('idle')
      })
    }
    if (recorder.state === 'inactive') {
      recorder.onstop?.(new Event('stop'))
      return
    }
    try { recorder.stop() } catch {
      setError(productText('结束录音失败，请重试'))
      setPhase('idle')
    }
  }

  return (
    <div className={collapsed ? 'dsh-knowledge-recorder collapsed' : 'dsh-knowledge-recorder'}
      role="dialog" aria-modal="true" aria-labelledby="dsh-knowledge-recorder-title">
      <header>
        <strong id="dsh-knowledge-recorder-title">{productText('录音纪要')}</strong>
        <button type="button" className="icon-only" aria-label={collapsed ? productText('展开') : productText('收起')}
          onClick={() => setCollapsed(value => !value)}>
          {collapsed ? '▢' : '▣'}
        </button>
      </header>
      {!collapsed && <>
        <div className="dsh-knowledge-recorder-stage">
          {liveTranscript !== ''
            ? <p className="dsh-knowledge-recorder-transcript">{liveTranscript}</p>
            : <p className="dsh-knowledge-recorder-placeholder">{productText('点击开始录音')}</p>}
          <time dateTime={`PT${Math.floor(elapsedMs / 1000)}S`}>{formatRecordingClock(elapsedMs)}</time>
        </div>
        {error !== '' && <p className="dsh-knowledge-recorder-error" role="alert">{error}</p>}
        <div className="dsh-knowledge-recorder-controls">
          <button type="button" className="dsh-knowledge-recorder-discard" aria-label={productText('取消录音')}
            onClick={discardRecording}>×</button>
          {phase === 'idle' || phase === 'stopping'
            ? <button type="button" className="dsh-knowledge-recorder-primary" aria-label={productText('开始录音')}
              disabled={phase === 'stopping'} onClick={() => void startRecording()}>▶</button>
            : phase === 'recording'
              ? <button type="button" className="dsh-knowledge-recorder-primary" aria-label={productText('暂停录音')}
                onClick={pauseRecording}>❚❚</button>
              : <button type="button" className="dsh-knowledge-recorder-primary" aria-label={productText('继续录音')}
                onClick={resumeRecording}>▶</button>}
          <button type="button" className="dsh-knowledge-recorder-confirm" aria-label={productText('完成录音')}
            disabled={phase === 'idle' || phase === 'stopping' || elapsedMs < 1000}
            onClick={() => finishRecording(false)}>✓</button>
        </div>
      </>}
    </div>
  )
}
