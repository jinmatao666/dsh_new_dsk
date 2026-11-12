// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentThumbnail } from '../src/client/DocumentThumbnail.tsx'

const pdf = vi.hoisted(() => ({
  getPage: vi.fn(async () => ({
    getViewport: () => ({ width: 260, height: 360 }),
    render: () => ({ promise: Promise.resolve() }),
  })),
  destroy: vi.fn(async () => {}),
}))
vi.mock('pdfjs-dist', () => ({ getDocument: () => ({ promise: Promise.resolve(pdf), destroy: pdf.destroy }) }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs', () => ({ WorkerMessageHandler: {} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

function pendingFile() {
  let resolve!: (file: { bytes: Uint8Array }) => void
  const promise = new Promise<{ bytes: Uint8Array }>((done) => { resolve = done })
  return { load: () => promise, finish: () => resolve({ bytes: new Uint8Array([1]) }) }
}

it('shows default PDF covers immediately and replaces each with its first page independently', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  const first = pendingFile()
  const second = pendingFile()
  const view = render(<>
    <DocumentThumbnail documentId="a" kind="pdf" load={first.load} />
    <DocumentThumbnail documentId="b" kind="pdf" load={second.load} />
  </>)
  expect(screen.getAllByText('PDF')).toHaveLength(2)
  expect(view.container.querySelectorAll('canvas:not([hidden])')).toHaveLength(0)
  await act(async () => { first.finish() })
  expect(screen.getAllByText('PDF')).toHaveLength(1)
  expect(view.container.querySelectorAll('canvas:not([hidden])')).toHaveLength(1)
  await act(async () => { second.finish() })
  expect(screen.queryByText('PDF')).toBeNull()
  expect(pdf.getPage.mock.calls).toEqual([[1], [1]])
  expect(view.container.querySelectorAll('canvas:not([hidden])')).toHaveLength(2)
  expect(view.container.querySelectorAll('.dsh-knowledge-thumbnail-badge')).toHaveLength(2)
  expect(screen.queryByRole('status')).toBeNull()
})

it('leaves the default cover when a PDF download fails', async () => {
  const load = vi.fn().mockRejectedValue(new Error('download failed'))
  const view = render(<DocumentThumbnail documentId="broken" kind="pdf" load={load} />)
  await act(async () => { await expect(load.mock.results[0]?.value).rejects.toThrow('download failed') })
  expect(view.container.querySelector('canvas')?.hidden).toBe(true)
  expect(screen.getByText('PDF')).toBeDefined()
})

it('shows non-PDF pages immediately without requesting previews', () => {
  const load = vi.fn()
  const view = render(<DocumentThumbnail documentId="audio" kind="audio" load={load} />)
  expect(view.container.querySelector('.dsh-knowledge-document-cover.audio')).not.toBeNull()
  expect(load).not.toHaveBeenCalled()
})

it('ignores downloads from an unmounted page', async () => {
  const file = pendingFile()
  const view = render(<DocumentThumbnail documentId="old" kind="pdf" load={file.load} />)
  view.unmount()
  await act(async () => { file.finish() })
  expect(pdf.getPage).not.toHaveBeenCalled()
})

it('waits for a PDF cover to scroll into view before downloading', () => {
  let notify!: IntersectionObserverCallback
  const observer = { observe: vi.fn(), disconnect: vi.fn() }
  vi.stubGlobal('IntersectionObserver', function (callback: IntersectionObserverCallback) {
    notify = callback
    return observer
  })
  const file = pendingFile()
  const load = vi.fn(file.load)
  const view = render(<DocumentThumbnail documentId="below-fold" kind="pdf" load={load} />)
  const element = view.container.querySelector('.dsh-knowledge-thumbnail')
  expect(observer.observe).toHaveBeenCalledWith(element)
  expect(screen.getByText('PDF')).toBeDefined()
  notify([{ isIntersecting: false } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
  expect(load).not.toHaveBeenCalled()
  notify([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
  expect(load).toHaveBeenCalledTimes(1)
  expect(observer.disconnect).toHaveBeenCalled()
})
