import { describe, expect, it } from 'vitest'
import {
  documentIsParsing, documentParseFailed, documentParsePercent, documentParseReady,
} from '../src/client/document-status.ts'

describe('document parse status', () => {
  it('treats DONE and completed progress as ready', () => {
    expect(documentParseReady({ run: 'DONE', progress: 1 })).toBe(true)
    expect(documentParseReady({ run: '3', progress: 0.2 })).toBe(true)
    expect(documentParseReady({ run: 'RUNNING', progress: 1 })).toBe(true)
    expect(documentParseReady({ run: 'RUNNING', progress: 0.3 })).toBe(false)
  })

  it('reports parsing progress as a whole percent', () => {
    expect(documentIsParsing({ run: 'RUNNING', progress: 0.03 })).toBe(true)
    expect(documentParsePercent({ run: 'RUNNING', progress: 0.03 })).toBe(3)
    expect(documentParseFailed({ run: 'FAIL', progress: 0 })).toBe(true)
    expect(documentIsParsing({ run: 'FAIL', progress: 0 })).toBe(false)
  })
})
