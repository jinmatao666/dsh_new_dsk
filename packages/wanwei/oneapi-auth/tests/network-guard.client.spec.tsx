// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NetworkGuard } from '../src/client/NetworkGuard.tsx'
import type { NetworkState } from '../src/network-contract.ts'

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__
})

function setup(network: NetworkState = { mode: 'internet', internalOrigins: [] }, native = vi.fn(async () => {})) {
  ;(window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__ = native
  const props = {
    useNetwork: <Selected,>(select: (value: NetworkState) => Selected) => select(network),
    t: (key: string) => key,
  } as Parameters<typeof NetworkGuard>[0]
  render(<><NetworkGuard {...props} /><a href="https://example.com/article" target="_blank" rel="noopener noreferrer"><span>来源文章</span></a></>)
  return { native, label: screen.getByText('来源文章'), link: screen.getByRole('link') }
}

it('opens a nested citation label once through the desktop command and cancels the WebView popup', () => {
  const { native, label } = setup()
  expect(fireEvent.click(label)).toBe(false)
  expect(native.mock.calls).toEqual([['open_external_link', { address: 'https://example.com/article' }]])
})

it('opens keyboard-activated citation links through the same native command', () => {
  const { native, label } = setup()
  fireEvent.click(label, { detail: 0 })
  expect(native).toHaveBeenCalledTimes(1)
})

it('keeps the browser context menu available without invoking the desktop command', () => {
  const { native, label } = setup()
  expect(fireEvent.contextMenu(label)).toBe(true)
  expect(fireEvent(label, new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }))).toBe(true)
  expect(native).not.toHaveBeenCalled()
})

it('retains ordinary browser navigation when the desktop bridge is absent', () => {
  const { native, label } = setup()
  delete (window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__
  expect(fireEvent.click(label)).toBe(true)
  expect(native).not.toHaveBeenCalled()
})

it('blocks public citations in private-network mode and explains the block', () => {
  const { native, label } = setup({ mode: 'intranet', internalOrigins: [] })
  expect(fireEvent.click(label)).toBe(false)
  expect(native).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toBe('networkUnavailable')
})

it('permits configured internal origins through the native opener in private-network mode', () => {
  const { native, label } = setup({ mode: 'intranet', internalOrigins: ['https://example.com'] })
  expect(fireEvent.click(label)).toBe(false)
  expect(native).toHaveBeenCalledTimes(1)
})

it('reports a native opening failure without leaving an unhandled rejection', async () => {
  const { native, label } = setup(undefined, vi.fn(async () => { throw new Error('opener unavailable') }))
  fireEvent.click(label)
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('externalLinkOpenFailed') })
  expect(native).toHaveBeenCalledTimes(1)
})

it.each([
  { href: 'file:///C:/report.pdf', target: '_blank', download: false },
  { href: '#section', target: '', download: false },
  { href: 'https://example.com/report.pdf', target: '_blank', download: true },
])('preserves file, internal-navigation and download behavior: $href', ({ href, target, download }) => {
  const { native, link } = setup()
  link.setAttribute('href', href)
  link.setAttribute('target', target)
  if (download) link.setAttribute('download', '')
  expect(fireEvent.click(link)).toBe(true)
  expect(native).not.toHaveBeenCalled()
})
