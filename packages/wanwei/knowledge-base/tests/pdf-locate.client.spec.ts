import { expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  Util: {
    transform: (_viewport: number[], item: number[]) => item,
  },
  getDocument: () => ({ promise: Promise.resolve({ numPages: 0, async destroy() {} }) }),
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs', () => ({
  WorkerMessageHandler: { setup() {} },
}))

import {
  highlightsForPage,
  normalizeBox,
  positionSpaceScale,
} from '../src/client/PdfLocateViewer.tsx'

it('scales DeepDoc page-image coords with the common ZM factor', () => {
  const rows = [
    { page: 1, left: 80, right: 1600, top: 200, bottom: 260 },
    { page: 1, left: 80, right: 1500, top: 280, bottom: 340 },
  ]
  const scale = positionSpaceScale(rows, 595, 842)
  expect(scale).toEqual({ x: 1 / 3, y: 1 / 3 })
  const box = normalizeBox(rows[0]!, 595, 842, scale)
  expect(box.left + box.width).toBeLessThanOrEqual(595 + 0.01)
})

it('maps 0–1000 layout coords onto the page', () => {
  const rows = [{ page: 1, left: 100, right: 900, top: 200, bottom: 260 }]
  const scale = positionSpaceScale(rows, 595, 842)
  expect(scale).toEqual({ x: 595 / 1000, y: 842 / 1000 })
  const box = normalizeBox(rows[0]!, 595, 842, scale)
  expect(box.left).toBeCloseTo(59.5, 5)
  expect(box.width).toBeCloseTo(476, 5)
})

it('prefers chunk position boxes over quote text search', () => {
  const highlights = highlightsForPage(
    {
      quote: '1. upload pdf word ppt files into the library',
      hint: '1. upload pdf word ppt files into the library',
      positions: [{ page: 1, left: 0.1, right: 0.9, top: 0.2, bottom: 0.28 }],
    },
    {
      pageNumber: 1,
      pageWidth: 595,
      pageHeight: 842,
      scale: 1,
      pieces: [
        { text: '1. upload pdf word ppt files into the library', left: 72, top: 380, width: 360, height: 16 },
      ],
    },
  )
  expect(highlights).toHaveLength(1)
  expect(highlights[0]!.top).toBeCloseTo(842 * 0.2, 5)
  expect(highlights[0]!.height).toBeCloseTo(842 * 0.08, 5)
})

it('falls back to quote text when chunk positions are absent', () => {
  const highlights = highlightsForPage(
    { quote: 'upload pdf word ppt files into the library' },
    {
      pageNumber: 1,
      pageWidth: 595,
      pageHeight: 842,
      scale: 1,
      pieces: [
        { text: 'Preface title', left: 260, top: 40, width: 80, height: 16 },
        { text: 'upload pdf word ppt files into the library', left: 72, top: 380, width: 360, height: 16 },
      ],
    },
  )
  expect(highlights).toHaveLength(1)
  expect(highlights[0]!.top).toBeCloseTo(380, 5)
})

it('returns no highlight when neither positions nor quote match', () => {
  const highlights = highlightsForPage(
    { quote: 'absent quote' },
    {
      pageNumber: 1,
      pageWidth: 595,
      pageHeight: 842,
      scale: 1,
      pieces: [{ text: 'Preface title', left: 260, top: 40, width: 80, height: 16 }],
    },
  )
  expect(highlights).toEqual([])
})
