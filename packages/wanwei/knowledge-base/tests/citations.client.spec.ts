import { expect, it } from 'vitest'
import {
  citationLocateHint,
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

it('keeps only PDF and Word locate markers and drops other document types', () => {
  const citations = parseCitations([
    { index: 1, chunk_index: 0, document_id: 'doc-pdf', document_name: '资料/制度.pdf', quote: '条款' },
    { index: 2, chunk_index: 1, document_id: 'doc-word', document_name: '说明.docx', quote: '说明' },
    { index: 3, chunk_index: 2, document_id: 'doc-txt', document_name: '笔记.txt', quote: '笔记' },
    { index: 4, chunk_index: 3, document_id: 'doc-xls', document_name: '表.xlsx', quote: '表格' },
  ])
  const parts = splitAnswerCitations('A##0$$ B##1$$ C##2$$ D##3$$。', citations)
  expect(parts).toEqual([
    { type: 'text', text: 'A' },
    { type: 'citation', citation: citations[0] },
    { type: 'text', text: ' B' },
    { type: 'citation', citation: citations[1] },
    { type: 'text', text: ' C D。' },
  ])
})

it('keeps only the first marker for each citation index', () => {
  const citations = parseCitations([
    { index: 1, chunk_index: 0, document_id: 'doc-a', document_name: 'a.pdf', quote: '条款' },
  ])
  const parts = splitAnswerCitations(
    '本规范修订的主要技术内容是：##0$$\n1. 架空层##0$$\n2. 落地橱窗##0$$。',
    citations,
  )
  expect(parts).toEqual([
    { type: 'text', text: '本规范修订的主要技术内容是：' },
    { type: 'citation', citation: citations[0] },
    { type: 'text', text: '\n1. 架空层\n2. 落地橱窗。' },
  ])
})

it('strips markers from empty-retrieval answers even when citations exist', () => {
  const citations = parseCitations([
    { index: 1, chunk_index: 0, document_id: 'doc-a', document_name: 'a.pdf', quote: '旧内容' },
  ])
  expect(splitAnswerCitations('知识库中未找到相关内容。##0$$', citations)).toEqual([
    { type: 'text', text: '知识库中未找到相关内容。' },
  ])
})

it('builds locate hints from the local claim before the marker', () => {
  expect(citationLocateHint('前言介绍。\n1. 上传各种格式内容到知识库')).toContain('上传各种格式内容到知识库')
  expect(citationLocateHint('1. 上传各种格式内容到知识库')).not.toContain('前言')
})
