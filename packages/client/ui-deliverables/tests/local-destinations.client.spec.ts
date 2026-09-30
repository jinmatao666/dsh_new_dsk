import { describe, expect, it, vi } from 'vitest'
import { producedFileMentions } from '../src/client/turn-deliverables.ts'

describe('recorded artifact destinations', () => {
  it('resolves URI-shaped Mac and Windows paths only to exact recorded artifacts', () => {
    const mac = '/Users/sam/测试 文件/报告.docx'
    const windows = 'C:/资料/报告.docx'
    const open = vi.fn()
    const mentions = producedFileMentions([mac, windows], open, path => `Open ${path}`)
    mentions.resolve(`file://${encodeURI(mac)}`)?.open()
    mentions.resolve('local-resource://Users/sam/测试 文件/报告.docx')?.open()
    mentions.resolve(`file:///${windows}`)?.open()
    expect(open.mock.calls).toEqual([[mac], [mac], [windows]])
    expect(mentions.resolve('local-resource://elsewhere/报告.docx')).toBeUndefined()
    expect(mentions.resolve('file:///%ZZ')).toBeUndefined()
    expect(mentions.resolve('javascript:alert(1)')).toBeUndefined()
  })

  it('preserves basename resolution and refuses ambiguous basenames', () => {
    const mentions = producedFileMentions(['/a/report.docx', '/b/report.docx'], vi.fn(), path => path)
    expect(mentions.resolve('report.docx')).toBeUndefined()
    expect(mentions.resolve('/a/report.docx')?.title).toBe('/a/report.docx')
  })
})
