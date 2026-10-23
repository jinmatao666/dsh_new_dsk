import { expect, it } from 'vitest'
import {
  parseCitations,
  splitAnswerCitations,
} from '../src/client/citations.ts'

it('maps ##i$$ markers onto locatable citation numbers', () => {
  const citations = parseCitations([
    {
      index: 1, chunk_index: 0, document_id: 'doc-a', document_name: 'a.pdf',
      quote: '条款', page: 2,
      positions: [{ page: 2, left: 10, right: 40, top: 50, bottom: 70 }],
    },
    {
      index: 2, chunk_index: 2, document_id: 'doc-b', document_name: 'b.pdf', quote: '说明',
    },
  ])
  const parts = splitAnswerCitations('结论##0$$，补充##2$$。', citations)
  expect(parts).toEqual([
    { type: 'text', text: '结论' },
    { type: 'citation', citation: citations[0] },
    { type: 'text', text: '，补充' },
    { type: 'citation', citation: citations[1] },
    { type: 'text', text: '。' },
  ])
})

it('maps RAGFlow [ID:i] markers onto the same citation slots', () => {
  const citations = parseCitations([
    { index: 1, chunk_index: 0, document_id: 'doc-a', document_name: 'a.pdf', quote: '条款' },
    { index: 2, chunk_index: 1, document_id: 'doc-b', document_name: 'b.pdf', quote: '说明' },
  ])
  const parts = splitAnswerCitations('准备工作包括：[ID:0]', citations)
  expect(parts).toEqual([
    { type: 'text', text: '准备工作包括：' },
    { type: 'citation', citation: citations[0] },
  ])
  expect(parts.some(part => part.type === 'text' && part.text.includes('[ID:'))).toBe(false)
})

it('leaves unmarked answers as plain text without inventing source chips', () => {
  const citations = parseCitations([
    { index: 1, chunk_index: 0, document_id: 'doc-a', document_name: 'a.pdf', quote: '条款' },
  ])
  expect(splitAnswerCitations('纯文本回答', citations)).toEqual([
    { type: 'text', text: '纯文本回答' },
  ])
})
