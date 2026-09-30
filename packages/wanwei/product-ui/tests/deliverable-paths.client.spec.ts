import { describe, expect, it } from 'vitest'
import { wanweiDeliverablePaths } from '../src/client/deliverable-paths.ts'

describe('Wanwei skill artifact markers', () => {
  it('preserves Mac spaces and Chinese filenames and retains Windows paths', () => {
    expect(wanweiDeliverablePaths([
      'DSH_WORD_PATH=/Users/sam/Desktop/测试 文件/会议纪要.docx',
      'DSH_EXCEL_PATH=C:\\资料\\地块分析.xlsx',
      'DSH_ANALYSIS_VIEW=/Users/sam/结果/分析视图_20260929_143224_983.json',
    ].join('\n'))).toEqual([
      '/Users/sam/Desktop/测试 文件/会议纪要.docx',
      'C:\\资料\\地块分析.xlsx',
      '/Users/sam/结果/分析视图_20260929_143224_983.json',
    ])
  })

  it('keeps the existing result protocol and deduplicates explicit paths', () => {
    expect(wanweiDeliverablePaths([
      'WANWEI_RESULT={bad',
      'WANWEI_RESULT={"success":false,"artifacts":[{"path":"bad.docx"}]}',
      'WANWEI_RESULT={"success":true,"artifacts":[{"path":"/tmp/报告.docx"},{"path":" "},{}]}',
      'DSH_WORD_PATH=/tmp/报告.docx',
    ].join('\n'))).toEqual(['/tmp/报告.docx'])
  })

  it('does not advertise artifacts from shell failures or arbitrary assistant links', () => {
    expect(wanweiDeliverablePaths('DSH_WORD_PATH=/tmp/报告.docx\n[exit code: 1]')).toEqual([])
    expect(wanweiDeliverablePaths('[报告](文件://Users/sam/报告.docx)')).toEqual([])
  })
})
