// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatSourcePreview, type OpenChatSource } from '../src/client/ChatSourcePreview.tsx'
import type { KnowledgeApi } from '../src/client/KnowledgePage.tsx'

vi.mock('../src/client/PdfLocateViewer.tsx', () => ({
  PdfLocateViewer: () => <div data-testid="pdf-preview" />,
}))
afterEach(cleanup)

it('opens and dismisses an original PDF above the conversation', async () => {
  let open: OpenChatSource | undefined
  const download = vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: 'application/pdf' }))
  render(<ChatSourcePreview api={{ download } as Pick<KnowledgeApi, 'download'> as KnowledgeApi}
    subscribeSource={(callback) => { open = callback; return () => { open = undefined } }} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => { open?.(15, 'doc-1', '制度.pdf', '') })
  expect(screen.getByRole('dialog').textContent).toContain('制度.pdf')
  await waitFor(() => expect(screen.getByTestId('pdf-preview')).toBeTruthy())
  expect(download).toHaveBeenCalledWith(15, 'doc-1')
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
