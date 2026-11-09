/** Host-side ASR + minutes generation for desktop knowledge 录音纪要 uploads. */

const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const MAX_TRANSCRIPT_CHARS = 60_000

export interface RecordingMinutesModels {
  /** OpenAI-compatible transcription model id routed by OneAPI. */
  transcriptionModel: string
  /** Chat model id used to draft 速览 / 纪要. */
  chatModel: string
}

export interface RecordingMinutesArtifacts {
  stem: string
  transcript: string
  overview: string
  minutes: string
  markdown: File
  audio: File
}

/** Build sectioned markdown stored in the knowledge library.
 * @param stem - `录音纪要_YYMMDDHHmmss` basename without extension.
 * @param transcript - ASR or live-caption text.
 * @param overview - 速览 body.
 * @param minutes - 纪要 body.
 */
export function buildRecordingMinutesDocument(
  stem: string,
  transcript: string,
  overview: string,
  minutes: string,
): string {
  const body = transcript.trim() === '' ? '（暂无逐字稿）' : transcript.trim()
  return [
    `# ${stem}`,
    '',
    '## 逐字稿',
    '',
    body,
    '',
    '## 速览',
    '',
    overview.trim() === '' ? '暂无速览' : overview.trim(),
    '',
    '## 纪要',
    '',
    minutes.trim() === '' ? '暂无纪要' : minutes.trim(),
    '',
  ].join('\n')
}

/** Local fallback 速览/纪要 when chat completions are unavailable.
 * @param transcript - ASR text.
 * @param durationMs - Recording length.
 */
export function draftRecordingMinutesLocally(
  transcript: string,
  durationMs: number,
): { overview: string; minutes: string } {
  const text = transcript.trim().replace(/\s+/g, ' ')
  const clock = formatClock(durationMs)
  if (text === '') {
    return {
      overview: `录音时长 ${clock}。未识别到有效语音内容。`,
      minutes: '本次录音未识别到可用正文，请重新录制或检查麦克风与转写服务。',
    }
  }
  const helloOnly = /^(你好[，,。.\s]*)+$/u.test(text)
  if (helloOnly) {
    const count = text.split('你好').length - 1
    const countLabel = chineseCountLabel(count)
    return {
      overview: `00:00 连续问候开场\n\n本章节为音频开场，说话人连续重复了${countLabel}“你好”作为问候。该段落无实质内容，仅为简单的寒暄或开场测试。`,
      minutes: [
        `本段音频主要为开场问候，说话人以连续重复的方式表达寒暄，录音短暂（${clock}），未进入正式议题。`,
        '',
        '### 简短问候与开场',
        '',
        `- **反复问候：** 说话人连续说了约${countLabel}「你好」，形成开场寒暄。`,
        '- **场景与主题判断：** 内容停留在问候层面，更像麦克风或开场测试，而非业务讨论。',
        '- **议题与结论：** 无实质议题、结论或待办事项。',
        `- **时长：** 约 ${clock}。`,
      ].join('\n'),
    }
  }
  const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text
  return {
    overview: `00:00 录音开场\n\n${preview}`,
    minutes: [
      `根据逐字稿整理如下，录音时长 ${clock}。下文仅归纳已出现内容，不补充未提及事实。`,
      '',
      '### 内容要点',
      '',
      `- **开场摘要：** ${preview}`,
      '- **议题与结论：** 逐字稿较短或未展开正式讨论，暂无明确结论。',
      '- **待办事项：** 未识别到可执行待办。',
      `- **时长：** 约 ${clock}。`,
    ].join('\n'),
  }
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Prefer short Chinese count labels in greeting fallbacks (Fig1 copy).
 * @param count - Number of 你好 tokens.
 */
function chineseCountLabel(count: number): string {
  const labels = [
    '零次', '一次', '两次', '三次', '四次', '五次', '六次', '七次', '八次', '九次', '十次', '十一次',
  ] as const
  return labels[count] ?? `${count}次`
}

/** Transcribe one WAV through OneAPI `/v1/audio/transcriptions`.
 * @param baseURL - OneAPI origin.
 * @param token - User bearer token.
 * @param audio - WAV file.
 * @param model - Transcription model id.
 * @param signal - Cancellation.
 */
export async function transcribeRecordingAudio(
  baseURL: string,
  token: string,
  audio: File,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const form = new FormData()
  form.set('file', audio, audio.name || 'recording.wav')
  form.set('model', model)
  form.set('response_format', 'json')
  const response = await fetch(`${baseURL.replace(/\/+$/, '')}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal,
    redirect: 'error',
  })
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('转写响应过大')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(response.ok ? '转写响应无效' : `转写失败（${response.status}）`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null
      ? String((body as { error?: { message?: unknown }; message?: unknown }).error?.message
        ?? (body as { message?: unknown }).message
        ?? `转写失败（${response.status}）`)
      : `转写失败（${response.status}）`
    throw new Error(message)
  }
  if (typeof body === 'object' && body !== null && typeof (body as { text?: unknown }).text === 'string') {
    return (body as { text: string }).text.trim()
  }
  throw new Error('转写结果为空')
}

/** Ask the chat model for 速览 and 纪要 JSON.
 * @param baseURL - OneAPI origin.
 * @param token - User bearer token.
 * @param model - Chat model id.
 * @param transcript - ASR text.
 * @param durationMs - Recording length.
 * @param signal - Cancellation.
 */
export async function summarizeRecordingTranscript(
  baseURL: string,
  token: string,
  model: string,
  transcript: string,
  durationMs: number,
  signal: AbortSignal,
): Promise<{ overview: string; minutes: string } | undefined> {
  const clipped = transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS)
  if (clipped === '') return undefined
  const response = await fetch(`${baseURL.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '你是会议纪要助手。只根据给定逐字稿归纳，不编造未出现的事实。',
            '输出严格 JSON：{"overview":"速览正文","minutes":"纪要正文"}。',
            '速览：第一行是“时间码 + 小节标题”（如 00:00 连续问候开场），空一行后再写一段说明。',
            '纪要：先写 1～2 句总述，再给一个 Markdown 三级标题（### 小节名），下列 3～5 条要点；',
            '每条以“- **标签：** 说明”形式书写（标签如反复问候、场景与主题判断、议题与结论、待办、时长）；',
            '若无议题/结论/待办，也要明确写出“无”。不要只输出一句短摘要。',
          ].join(''),
        },
        {
          role: 'user',
          content: `录音时长 ${formatClock(durationMs)}。\n逐字稿：\n${clipped}`,
        },
      ],
    }),
    signal,
    redirect: 'error',
  })
  const text = await response.text()
  if (!response.ok || text.length > 1_000_000) return undefined
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  const content = (body as {
    choices?: Array<{ message?: { content?: unknown } }>
  }).choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') return undefined
  const match = content.match(/\{[\s\S]*\}/)
  if (match === null) return undefined
  try {
    const parsed = JSON.parse(match[0]) as { overview?: unknown; minutes?: unknown }
    if (typeof parsed.overview !== 'string' || typeof parsed.minutes !== 'string') return undefined
    return { overview: parsed.overview.trim(), minutes: parsed.minutes.trim() }
  } catch {
    return undefined
  }
}

/** Validate multipart fields for the desktop recording-minutes import route.
 * @param form - Browser FormData.
 */
export function readRecordingMinutesForm(form: FormData): {
  libraryId: number
  audio: File
  stem: string
  durationMs: number
  liveTranscript: string
} {
  const idRaw = form.get('id')
  const libraryId = typeof idRaw === 'string' ? Number(idRaw) : Number.NaN
  if (!Number.isSafeInteger(libraryId) || libraryId <= 0) throw new Error('知识库编号无效')
  const uploaded = form.get('file')
  if (!(uploaded instanceof Blob) || uploaded.size <= 0) throw new Error('请上传录音文件')
  if (uploaded.size > MAX_AUDIO_BYTES) throw new Error('录音不能超过 20MB')
  const uploadedName = uploaded instanceof File && uploaded.name.trim() !== ''
    ? uploaded.name
    : 'recording.wav'
  const uploadedType = uploaded.type || 'audio/wav'
  const name = uploadedName.toLowerCase()
  if (!(name.endsWith('.wav') || uploadedType === 'audio/wav' || uploadedType === 'audio/wave')) {
    throw new Error('录音须为 WAV 格式')
  }
  const audio = new File(
    [uploaded],
    name.endsWith('.wav') ? uploadedName : 'recording.wav',
    { type: 'audio/wav' },
  )
  const stemRaw = form.get('stem')
  const stem = typeof stemRaw === 'string' ? stemRaw.trim() : ''
  if (!/^录音纪要_\d{12}$/u.test(stem)) throw new Error('录音文件名无效')
  const durationRaw = form.get('durationMs')
  const durationMs = typeof durationRaw === 'string' ? Number(durationRaw) : 0
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 20 * 60 * 1000) {
    throw new Error('录音时长无效')
  }
  const liveRaw = form.get('liveTranscript')
  const liveTranscript = typeof liveRaw === 'string' ? liveRaw.trim().slice(0, MAX_TRANSCRIPT_CHARS) : ''
  return { libraryId, audio, stem, durationMs, liveTranscript }
}
