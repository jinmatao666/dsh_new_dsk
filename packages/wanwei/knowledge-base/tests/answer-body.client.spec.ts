import { expect, it } from 'vitest'
import { prepareAnswerHtml } from '../src/client/AnswerBody.tsx'
import { parseCitations } from '../src/client/citations.ts'

it('renders markdown headings and lists for answer hierarchy', () => {
  const { html } = prepareAnswerHtml(
    '## PC 端步骤\n\n1. 收藏知识\n2. 管理标签\n\n### 说明\n\n支持多种格式。',
    [],
  )
  expect(html).toContain('<h2>')
  expect(html).toContain('PC 端步骤')
  expect(html).toContain('<ol>')
  expect(html).toContain('<h3>')
})

it('keeps citation buttons after markdown rendering', () => {
  const citations = parseCitations([
    {
      index: 1, chunk_index: 0, document_id: 'doc-a', document_name: 'a.pdf',
      quote: '条款',
    },
  ])
  const { html, citations: slots } = prepareAnswerHtml(
    '## 结论\n\n依据制度执行。##0$$',
    citations,
  )
  expect(html).toContain('<h2>')
  expect(html).toContain('data-cite="0"')
  expect(html).toContain('【1】')
  expect(slots[0]?.document_id).toBe('doc-a')
})
