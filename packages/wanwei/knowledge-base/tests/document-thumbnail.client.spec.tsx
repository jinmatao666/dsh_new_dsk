// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DocumentThumbnail } from '../src/client/DocumentThumbnail.tsx'

afterEach(cleanup)

const coverSrc = '/api/desktop-knowledge-file?id=1&documentId=doc-1&cover=1'

it('requests the stored image once available and keeps the placeholder until it loads', () => {
  const view = render(<DocumentThumbnail kind="pdf" src={undefined} />)
  expect(screen.getByText('PDF')).toBeTruthy()
  expect(view.container.querySelector('img')).toBeNull()
  view.rerender(<DocumentThumbnail kind="pdf" src={coverSrc} />)
  const image = view.container.querySelector('img')
  expect(image?.getAttribute('src')).toBe(coverSrc)
  expect(screen.getByText('PDF')).toBeTruthy()
  if (image === null) throw new Error('Missing cover image')
  fireEvent.load(image)
  expect(screen.queryByText('PDF')).toBeNull()
})

it('keeps the placeholder when the browser cannot load the JPEG', () => {
  const view = render(<DocumentThumbnail kind="pdf" src={coverSrc} />)
  const image = view.container.querySelector('img')
  if (image === null) throw new Error('Missing cover image')
  fireEvent.error(image)
  expect(image.hidden).toBe(true)
  expect(screen.getByText('PDF')).toBeTruthy()
})
