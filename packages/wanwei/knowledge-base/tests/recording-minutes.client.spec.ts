import { describe, expect, it } from 'vitest'
import {
  buildRecordingAudioFile,
  buildRecordingMinutesMarkdown,
  encodePcmWavBytes,
  formatRecordingClock,
  isRecordingMinutesAudioName,
  isRecordingMinutesName,
  parseRecordingMinutesMarkdown,
  recordingMinutesBaseStem,
  recordingMinutesStem,
} from '../src/client/recording-minutes.ts'

describe('recording minutes helpers', () => {
  it('builds a local stem and classifies paired artifacts', () => {
    const stem = recordingMinutesStem(1_762_387_977_000)
    expect(stem).toMatch(/^录音纪要_\d{12}$/)
    expect(isRecordingMinutesName(`${stem}.webm`)).toBe(true)
    expect(isRecordingMinutesAudioName(`${stem}.webm`)).toBe(true)
    expect(isRecordingMinutesName(`${stem}.md`)).toBe(true)
    expect(isRecordingMinutesAudioName(`${stem}.md`)).toBe(false)
    expect(isRecordingMinutesName('说明.pdf')).toBe(false)
    expect(recordingMinutesBaseStem(`${stem}.webm`)).toBe(stem)
  })

  it('formats clocks and packages audio plus markdown sections', () => {
    expect(formatRecordingClock(5_000)).toBe('00:05')
    expect(formatRecordingClock(65_000)).toBe('01:05')
    const audio = buildRecordingAudioFile(new Blob(['abc'], { type: 'audio/webm' }), 'audio/webm', '录音纪要_261106091257')
    expect(audio.name).toBe('录音纪要_261106091257.webm')
    expect(audio.type).toBe('audio/webm')
    const markdown = buildRecordingMinutesMarkdown('录音纪要_261106091257', '你好，你好', 5_000)
    const sections = parseRecordingMinutesMarkdown(markdown)
    expect(sections.transcript).toContain('你好，你好')
    expect(sections.overview).toContain('00:05')
    expect(sections.minutes).toContain('你好，你好')
  })

  it('encodes a PCM WAV header for RAGFlow-compatible uploads', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1])
    const buffer = {
      numberOfChannels: 1,
      sampleRate: 16_000,
      length: samples.length,
      getChannelData: () => samples,
    } as unknown as AudioBuffer
    const bytes = new Uint8Array(encodePcmWavBytes(buffer))
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE')
    expect(bytes.byteLength).toBe(44 + samples.length * 2)
  })
})
