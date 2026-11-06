/** Prefix for desktop recording-minutes uploads (`录音纪要_YYMMDDHHmmss`). */
export const RECORDING_MINUTES_PREFIX = '录音纪要_'

/** Maximum recording length before the panel auto-stops (20 minutes). */
export const RECORDING_MAX_MS = 20 * 60 * 1000

/** Preferred MediaRecorder MIME types, first supported wins. */
const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const

/** Pick a MediaRecorder MIME type the browser can encode.
 * @returns MIME string, or empty when MediaRecorder is unavailable.
 */
export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

/** File extension for a recorder MIME type.
 * @param mimeType - MediaRecorder `mimeType`, possibly with codecs.
 */
export function extensionForRecorderMime(mimeType: string): 'webm' | 'ogg' | 'm4a' {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (base === 'audio/ogg') return 'ogg'
  if (base === 'audio/mp4') return 'm4a'
  return 'webm'
}

/** Local `录音纪要_YYMMDDHHmmss` stem from a wall-clock instant.
 * @param at - Epoch milliseconds.
 */
export function recordingMinutesStem(at: number = Date.now()): string {
  const date = new Date(at)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  const stamp = `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${RECORDING_MINUTES_PREFIX}${stamp}`
}

/** Whether a displayed file name is a recording-minutes artifact.
 * @param name - Document display name (base name).
 */
export function isRecordingMinutesName(name: string): boolean {
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  if (!base.startsWith(RECORDING_MINUTES_PREFIX)) return false
  const extension = base.split('.').pop()?.toLowerCase() ?? ''
  return ['webm', 'ogg', 'm4a', 'mp3', 'wav', 'mp4', 'md', 'markdown', 'txt'].includes(extension)
}

/** Whether a file name is a recording-minutes audio file.
 * @param name - Document display name.
 */
export function isRecordingMinutesAudioName(name: string): boolean {
  if (!isRecordingMinutesName(name)) return false
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return ['webm', 'ogg', 'm4a', 'mp3', 'wav', 'mp4'].includes(extension)
}

/** Stem without extension for pairing audio and markdown siblings.
 * @param name - Document display name.
 */
export function recordingMinutesBaseStem(name: string): string {
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Format a millisecond duration as `MM:SS`.
 * @param ms - Elapsed milliseconds (clamped at zero).
 */
export function formatRecordingClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Build the audio File uploaded after a successful recording.
 * @param blob - Encoded audio blob from MediaRecorder.
 * @param mimeType - Recorder MIME type.
 * @param stem - Shared `录音纪要_…` stem.
 */
export function buildRecordingAudioFile(blob: Blob, mimeType: string, stem: string): File {
  const extension = extensionForRecorderMime(mimeType)
  const type = mimeType.split(';')[0]?.trim() || blob.type || `audio/${extension}`
  return new File([blob], `${stem}.${extension}`, { type })
}

/** Encode one AudioBuffer as little-endian 16-bit mono/stereo PCM WAV bytes.
 * @param buffer - Decoded Web Audio buffer.
 */
export function encodePcmWavBytes(buffer: AudioBuffer): ArrayBuffer {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels))
  const sampleRate = buffer.sampleRate
  const frameCount = buffer.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataSize = frameCount * blockAlign
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)
  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index))
  let offset = 44
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel]?.[frame] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return out
}

/**
 * Decode a MediaRecorder blob and re-encode as mono 16 kHz PCM WAV for ASR upload.
 * Browser recorders typically emit webm/ogg; knowledge import expects WAV.
 * @param blob - Encoded recorder output.
 * @param stem - Shared `录音纪要_…` stem.
 */
export async function buildRecordingWavFile(blob: Blob, stem: string): Promise<File> {
  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (AudioContextCtor === undefined) {
    throw new Error('当前环境无法转换录音格式')
  }
  const context = new AudioContextCtor()
  try {
    const source = await blob.arrayBuffer()
    const decoded = await context.decodeAudioData(source.slice(0))
    const mono = mixToMono(decoded)
    const wav = encodePcmWavBytes(await resampleMono(mono, 16_000))
    return new File([wav], `${stem}.wav`, { type: 'audio/wav' })
  } finally {
    await context.close().catch(() => {
      // Named: AudioContext close can reject after the context is already closing.
    })
  }
}

function mixToMono(buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels <= 1) return buffer
  const length = buffer.length
  const mono = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: buffer.sampleRate })
  const out = mono.getChannelData(0)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  for (let index = 0; index < length; index += 1) {
    let sum = 0
    for (const channel of channels) sum += channel[index] ?? 0
    out[index] = sum / channels.length
  }
  return mono
}

async function resampleMono(buffer: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === sampleRate) return buffer
  const frameCount = Math.max(1, Math.round(buffer.duration * sampleRate))
  const offline = new OfflineAudioContext(1, frameCount, sampleRate)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start(0)
  return offline.startRendering()
}

/** Parsed sections from a recording-minutes markdown companion. */
export interface RecordingMinutesSections {
  transcript: string
  overview: string
  minutes: string
}

const SECTION_HEADINGS = {
  transcript: '逐字稿',
  overview: '速览',
  minutes: '纪要',
} as const

/** Build markdown uploaded alongside audio when a live transcript exists.
 * @param stem - Shared `录音纪要_…` stem.
 * @param transcript - Live speech-recognition text (may be empty).
 * @param durationMs - Recorded duration.
 */
export function buildRecordingMinutesMarkdown(
  stem: string,
  transcript: string,
  durationMs: number,
): string {
  const body = transcript.trim()
  const overview = body === ''
    ? `录音时长 ${formatRecordingClock(durationMs)}。未捕获实时转写；解析完成后可在预览中查看切片文本。`
    : `录音时长 ${formatRecordingClock(durationMs)}。开场内容基于实时转写整理，仅供参考。`
  const minutes = body === ''
    ? '暂无纪要正文。可在预览中编辑后重新上传，或等待知识库解析完成。'
    : body
  return [
    `# ${stem}`,
    '',
    `## ${SECTION_HEADINGS.transcript}`,
    '',
    body === '' ? '（暂无逐字稿）' : body,
    '',
    `## ${SECTION_HEADINGS.overview}`,
    '',
    overview,
    '',
    `## ${SECTION_HEADINGS.minutes}`,
    '',
    minutes,
    '',
  ].join('\n')
}

/** Parse `## 逐字稿` / `## 速览` / `## 纪要` sections from companion markdown.
 * @param source - Markdown file text.
 */
export function parseRecordingMinutesMarkdown(source: string): RecordingMinutesSections {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const buckets: Record<keyof typeof SECTION_HEADINGS, string[]> = {
    transcript: [], overview: [], minutes: [],
  }
  let current: keyof typeof SECTION_HEADINGS | undefined
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading !== null) {
      const title = heading[1] ?? ''
      if (title === SECTION_HEADINGS.transcript) { current = 'transcript'; continue }
      if (title === SECTION_HEADINGS.overview) { current = 'overview'; continue }
      if (title === SECTION_HEADINGS.minutes) { current = 'minutes'; continue }
      current = undefined
      continue
    }
    if (current !== undefined) buckets[current].push(line)
  }
  const trimJoin = (parts: string[]) => parts.join('\n').trim()
  return {
    transcript: trimJoin(buckets.transcript),
    overview: trimJoin(buckets.overview),
    minutes: trimJoin(buckets.minutes),
  }
}

/** Build the companion markdown File when live transcript text is present.
 * @param stem - Shared stem.
 * @param transcript - Live recognition text.
 * @param durationMs - Recorded duration.
 */
export function buildRecordingMinutesMarkdownFile(
  stem: string,
  transcript: string,
  durationMs: number,
): File {
  const text = buildRecordingMinutesMarkdown(stem, transcript, durationMs)
  return new File([text], `${stem}.md`, { type: 'text/markdown;charset=utf-8' })
}
