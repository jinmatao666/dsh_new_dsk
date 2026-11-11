// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentThumbnail, DocumentThumbnailPage } from '../src/client/DocumentThumbnail.tsx'

const pdf = vi.hoisted(() => ({
  getPage: vi.fn(async () => ({
    getViewport: () => ({ width: 260, height: 360 }),
    render: () => ({ promise: Promise.resolve() }),
  })),
  destroy: vi.fn(async () => {}),
}))
vi.mock('pdfjs-dist', () => ({ getDocument: () => ({ promise: Promise.resolve(pdf), destroy: pdf.destroy }) }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs', () => ({ WorkerMessageHandler: {} }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

function pendingFile() {
  let resolve!: (file: { bytes: Uint8Array }) => void
  const promise = new Promise<{ bytes: Uint8Array }>((done) => { resolve = done })
  return { load: () => promise, finish: () => resolve({ bytes: new Uint8Array([1]) }) }
}

it('keeps all cards hidden until every first page is rendered', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  const first = pendingFile()
  const second = pendingFile()
  const view = render(<DocumentThumbnailPage documentIds={['a', 'b']}>
    <DocumentThumbnail documentId="a" kind="pdf" load={first.load} fallback={<span>file a</span>} />
    <DocumentThumbnail documentId="b" kind="pdf" load={second.load} fallback={<span>file b</span>} />
  </DocumentThumbnailPage>)
  const grid = view.container.querySelector('.dsh-knowledge-documents')!
  expect(grid.hasAttribute('hidden')).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('加载中')
  await act(async () => { first.finish() })
  expect(grid.hasAttribute('hidden')).toBe(true)
  await act(async () => { second.finish() })
  await waitFor(() => expect(grid.hasAttribute('hidden')).toBe(false))
  expect(pdf.getPage.mock.calls).toEqual([[1], [1]])
  expect(view.container.querySelectorAll('canvas:not([hidden])')).toHaveLength(2)
  expect(view.container.querySelectorAll('.dsh-knowledge-thumbnail-badge')).toHaveLength(2)
  expect(screen.queryByRole('status')).toBeNull()
})

it('finishes loading when a PDF fails and leaves its file icon', async () => {
  const view = render(<DocumentThumbnailPage documentIds={['broken']}>
    <DocumentThumbnail documentId="broken" kind="pdf" load={async () => { throw new Error('download failed') }} fallback={<span>file icon</span>} />
  </DocumentThumbnailPage>)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(view.container.querySelector('.dsh-knowledge-documents')!.hasAttribute('hidden')).toBe(false)
  expect(screen.getByText('file icon')).toBeDefined()
})

it('shows non-PDF pages immediately without requesting previews', () => {
  const load = vi.fn()
  render(<DocumentThumbnailPage documentIds={[]}>
    <DocumentThumbnail documentId="audio" kind="audio" load={load} fallback={<span>audio</span>} />
  </DocumentThumbnailPage>)
  expect(screen.queryByRole('status')).toBeNull()
  expect(load).not.toHaveBeenCalled()
})

it('ignores downloads from an unmounted page', async () => {
  const file = pendingFile()
  const view = render(<DocumentThumbnailPage documentIds={['old']}>
    <DocumentThumbnail documentId="old" kind="pdf" load={file.load} fallback={null} />
  </DocumentThumbnailPage>)
  view.unmount()
  await act(async () => { file.finish() })
  expect(pdf.getPage).not.toHaveBeenCalled()
})
