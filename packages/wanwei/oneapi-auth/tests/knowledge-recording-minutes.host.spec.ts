import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'
import {
  buildRecordingMinutesDocument,
  draftRecordingMinutesLocally,
  readRecordingMinutesForm,
  summarizeRecordingTranscript,
  transcribeRecordingAudio,
} from '../src/knowledge-recording-minutes.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('drafts Fig1-style 速览 and structured 纪要 for repeated 你好 greetings', () => {
  const drafted = draftRecordingMinutesLocally('你好，你好，你好，你好，你好，你好，你好，你好，你好，你好，你好。', 5_000)
  expect(drafted.overview).toContain('连续问候开场')
  expect(drafted.overview).toContain('重复了十一次')
  expect(drafted.minutes).toContain('### 简短问候与开场')
  expect(drafted.minutes).toContain('**反复问候：**')
  expect(drafted.minutes).toContain('十一次')
  expect(drafted.minutes).toContain('**场景与主题判断：**')
})

it('drafts empty and truncated fallbacks', () => {
  expect(draftRecordingMinutesLocally('   ', 3_000).overview).toContain('未识别到有效语音内容')
  expect(draftRecordingMinutesLocally('你好', 1_000).overview).toContain('一次')
  expect(draftRecordingMinutesLocally('普通开场', 1_500).overview).toContain('普通开场')
  const long = '议题讨论'.repeat(40)
  const drafted = draftRecordingMinutesLocally(long, 12_000)
  expect(drafted.overview).toContain('…')
  expect(drafted.minutes).toContain('### 内容要点')
  expect(drafted.minutes).toContain('**开场摘要：**')
  expect(draftRecordingMinutesLocally('你好'.repeat(12), 2_000).minutes).toContain('12次')
})

it('builds sectioned markdown for the minutes viewer', () => {
  const text = buildRecordingMinutesDocument(
    '录音纪要_261106091257',
    '',
    '',
    '',
  )
  expect(text).toContain('（暂无逐字稿）')
  expect(text).toContain('暂无速览')
  expect(text).toContain('暂无纪要')
  const filled = buildRecordingMinutesDocument(
    '录音纪要_261106091257',
    '你好，你好',
    '00:00 连续问候开场\n\n说明',
    '无议题',
  )
  expect(filled).toContain('## 逐字稿')
  expect(filled).toContain('你好，你好')
  expect(filled).toContain('## 速览')
  expect(filled).toContain('## 纪要')
})

it('reads multipart recording-minutes fields and rejects invalid ones', () => {
  const form = new FormData()
  form.set('id', '12')
  form.set('file', new File([new Uint8Array([1, 2, 3])], '录音纪要_261106091257.wav', { type: 'audio/wav' }))
  form.set('stem', '录音纪要_261106091257')
  form.set('durationMs', '3500')
  form.set('liveTranscript', '现场字幕')
  expect(readRecordingMinutesForm(form)).toEqual({
    libraryId: 12,
    audio: expect.any(File),
    stem: '录音纪要_261106091257',
    durationMs: 3500,
    liveTranscript: '现场字幕',
  })

  const blobForm = new FormData()
  blobForm.set('id', '3')
  blobForm.set('file', new Blob([new Uint8Array([9])], { type: 'audio/wave' }))
  blobForm.set('stem', '录音纪要_261106113022')
  blobForm.set('durationMs', '0')
  const fromBlob = readRecordingMinutesForm(blobForm)
  expect(fromBlob.audio).toBeInstanceOf(File)
  expect(fromBlob.audio.name).toBe('recording.wav')

  const emptyName = new FormData()
  emptyName.set('id', '3')
  emptyName.set('file', new File([new Uint8Array([9])], '', { type: '' }))
  emptyName.set('stem', '录音纪要_261106113022')
  expect(readRecordingMinutesForm(emptyName).audio.name).toBe('recording.wav')
  expect(readRecordingMinutesForm(emptyName).durationMs).toBe(0)

  expect(() => readRecordingMinutesForm(new FormData())).toThrow('知识库编号无效')
  const badFile = new FormData()
  badFile.set('id', '1')
  expect(() => readRecordingMinutesForm(badFile)).toThrow('请上传录音文件')
  const huge = new FormData()
  huge.set('id', '1')
  huge.set('file', new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'a.wav', { type: 'audio/wav' }))
  expect(() => readRecordingMinutesForm(huge)).toThrow('录音不能超过 20MB')
  const wrongType = new FormData()
  wrongType.set('id', '1')
  wrongType.set('file', new File([new Uint8Array([1])], 'a.webm', { type: 'audio/webm' }))
  expect(() => readRecordingMinutesForm(wrongType)).toThrow('录音须为 WAV 格式')
  const badStem = new FormData()
  badStem.set('id', '1')
  badStem.set('file', new File([new Uint8Array([1])], 'a.wav', { type: 'audio/wav' }))
  badStem.set('stem', 'bad')
  badStem.set('durationMs', '1')
  expect(() => readRecordingMinutesForm(badStem)).toThrow('录音文件名无效')
  const missingStem = new FormData()
  missingStem.set('id', '1')
  missingStem.set('file', new File([new Uint8Array([1])], 'a.wav', { type: 'audio/wav' }))
  missingStem.set('durationMs', '1')
  expect(() => readRecordingMinutesForm(missingStem)).toThrow('录音文件名无效')
  const badDuration = new FormData()
  badDuration.set('id', '1')
  badDuration.set('file', new File([new Uint8Array([1])], 'a.wav', { type: 'audio/wav' }))
  badDuration.set('stem', '录音纪要_261106091257')
  badDuration.set('durationMs', '-1')
  expect(() => readRecordingMinutesForm(badDuration)).toThrow('录音时长无效')
})

it('transcribes WAV through OneAPI and surfaces upstream errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: '  你好  ' })))
  await expect(transcribeRecordingAudio(
    'https://one.example/', 'tok', new File([new Uint8Array([1])], '', { type: 'audio/wav' }), 'asr', AbortSignal.timeout(5_000),
  )).resolves.toBe('你好')

  vi.stubGlobal('fetch', vi.fn(async () => new Response('{')))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('转写响应无效')

  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('转写失败（500）')

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: '上游拒绝' } }, { status: 400 })))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('上游拒绝')

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: '配额不足' }, { status: 429 })))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('配额不足')

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true }, { status: 502 })))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('转写失败（502）')

  vi.stubGlobal('fetch', vi.fn(async () => new Response('"x"', {
    status: 400, headers: { 'content-type': 'application/json' },
  })))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('转写失败（400）')

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: 1 })))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('转写结果为空')

  vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1_000_001))))
  await expect(transcribeRecordingAudio(
    'https://one.example', 'tok', new File([new Uint8Array([1])], 'a.wav'), 'asr', AbortSignal.timeout(5_000),
  )).rejects.toThrow('转写响应过大')
})

it('summarizes transcripts into 速览/纪要 JSON and ignores bad responses', async () => {
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '   ', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    choices: [{ message: { content: '说明\n{"overview":"速览A","minutes":"纪要B"}' } }],
  })))
  await expect(summarizeRecordingTranscript(
    'https://one.example/', 'tok', 'chat', '正文', 2500, AbortSignal.timeout(5_000),
  )).resolves.toEqual({ overview: '速览A', minutes: '纪要B' })

  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1_000_001))))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => new Response('{')))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '   ' } }] })))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '无 JSON' } }] })))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    choices: [{ message: { content: '{"overview":1,"minutes":"x"}' } }],
  })))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    choices: [{ message: { content: '{bad' } }],
  })))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()

  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    choices: [{ message: { content: '{bad}' } }],
  })))
  await expect(summarizeRecordingTranscript(
    'https://one.example', 'tok', 'chat', '正文', 1000, AbortSignal.timeout(5_000),
  )).resolves.toBeUndefined()
})

it('imports recording minutes through ASR, local draft, and document upload', async () => {
  const uploads: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/transcriptions')) {
      return Response.json({ text: '你好，你好，你好' })
    }
    if (url.endsWith('/v1/chat/completions')) {
      return Response.json({
        choices: [{ message: { content: '{"overview":"速览","minutes":"纪要"}' } }],
      })
    }
    if (url.includes('/documents') && init?.method === 'POST') {
      const form = init.body as FormData
      const file = form.get('file') as File
      uploads.push(file.name)
      return Response.json({ success: true, data: [{ id: `doc-${uploads.length}` }] })
    }
    throw new Error(`unexpected ${url}`)
  }))
  const api = new KnowledgeBaseApi(
    'https://one.example', async () => 'token', 60_000,
    { transcriptionModel: 'asr', chatModel: 'chat' },
  )
  const form = new FormData()
  form.set('id', '7')
  form.set('file', new File([new Uint8Array([1, 2])], '录音纪要_261106091257.wav', { type: 'audio/wav' }))
  form.set('stem', '录音纪要_261106091257')
  form.set('durationMs', '5000')
  const response = await api.importRecordingMinutes(new Request(
    'https://desktop.local/api/desktop-knowledge-recording-minutes',
    { method: 'POST', body: form },
  ))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ success: true, data: { stem: '录音纪要_261106091257' } })
  expect(uploads).toEqual(['录音纪要_261106091257.md', '录音纪要_261106091257.wav'])
})

it('falls back to live captions and local draft when ASR or chat is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/transcriptions')) {
      return Response.json({ text: '   ' })
    }
    if (url.includes('/documents') && init?.method === 'POST') {
      return Response.json({ success: true, data: [{ id: 'doc' }] })
    }
    throw new Error(`unexpected ${url}`)
  }))
  const api = new KnowledgeBaseApi(
    'https://one.example', async () => 'token', 60_000,
    { transcriptionModel: 'asr', chatModel: '' },
  )
  const form = new FormData()
  form.set('id', '7')
  form.set('file', new File([new Uint8Array([1])], '录音纪要_261106113022.wav', { type: 'audio/wav' }))
  form.set('stem', '录音纪要_261106113022')
  form.set('durationMs', '3000')
  form.set('liveTranscript', '你好，你好')
  const response = await api.importRecordingMinutes(new Request(
    'https://desktop.local/api/desktop-knowledge-recording-minutes',
    { method: 'POST', body: form },
  ))
  expect(response.status).toBe(200)
  expect((await response.json()).success).toBe(true)

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/transcriptions')) {
      return Response.json({ error: { message: 'down' } }, { status: 503 })
    }
    if (url.includes('/documents') && init?.method === 'POST') {
      return Response.json({ success: true, data: [{ id: 'doc' }] })
    }
    throw new Error(`unexpected ${url}`)
  }))
  const asrDown = await api.importRecordingMinutes(new Request(
    'https://desktop.local/api/desktop-knowledge-recording-minutes',
    { method: 'POST', body: form },
  ))
  expect(asrDown.status).toBe(200)

  const denied = new KnowledgeBaseApi(
    'https://one.example', async () => undefined, 60_000,
    { transcriptionModel: 'asr', chatModel: 'chat' },
  )
  const deniedForm = new FormData()
  deniedForm.set('id', '7')
  deniedForm.set('file', new File([new Uint8Array([1])], '录音纪要_261106113022.wav', { type: 'audio/wav' }))
  deniedForm.set('stem', '录音纪要_261106113022')
  deniedForm.set('durationMs', '3000')
  const unauthorized = await denied.importRecordingMinutes(new Request(
    'https://desktop.local/api/desktop-knowledge-recording-minutes',
    { method: 'POST', body: deniedForm },
  ))
  expect(unauthorized.status).toBe(401)

  const invalid = await api.importRecordingMinutes(new Request(
    'https://desktop.local/api/desktop-knowledge-recording-minutes',
    { method: 'POST', body: new FormData() },
  ))
  expect(invalid.status).toBe(400)
})
