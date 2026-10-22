// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MarkdownView } from '../src/client/MarkdownView.tsx'

afterEach(cleanup)

it('renders Markdown headings, quotes, bold, and code', () => {
  render(<MarkdownView source={'## 知识库管理\n\n> 准备工作\n\n调用 **POST** `/api/v1/datasets`'} />)
  expect(screen.getByRole('heading', { level: 2, name: '知识库管理' })).toBeTruthy()
  expect(screen.getByText('准备工作').closest('blockquote')).toBeTruthy()
  expect(screen.getByText('POST').tagName).toBe('STRONG')
  expect(screen.getByText('/api/v1/datasets').tagName).toBe('CODE')
})

it('strips script tags from Markdown HTML', () => {
  const { container } = render(<MarkdownView source={'安全\n\n<script>alert(1)</script>\n\n正文'} />)
  expect(container.querySelector('script')).toBeNull()
  expect(container.textContent).toContain('正文')
})
