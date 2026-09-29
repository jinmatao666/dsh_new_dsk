// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { ExpertWebview } from '../src/client/expert-webview.tsx'

const launch = { id: 'geology-analysis', name: '地质专家', url: 'https://example.com/workbench', ticket: 'a'.repeat(64) }

afterEach(() => {
  cleanup()
  delete (window as Window & { __ZJUGIS_NATIVE_INVOKE__?: unknown }).__ZJUGIS_NATIVE_INVOKE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('same-window expert webview lifecycle', () => {
  it('switches independent native children without recreating or closing background experts', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 100, width: 800, height: 560 } as DOMRect)
    const second = { ...launch, id: 'second-expert', ticket: 'b'.repeat(64) }
    const invoke = vi.fn(async (command: string, args: Record<string, unknown>) =>
      command === 'open_expert_webview' ? `view-${String(args.key)}` : undefined)
    ;(window as Window & { __ZJUGIS_NATIVE_INVOKE__?: typeof invoke }).__ZJUGIS_NATIVE_INVOKE__ = invoke
    const onError = vi.fn()
    const view = render(<>
      <ExpertWebview launch={launch} visible onError={onError} />
      <ExpertWebview launch={second} visible={false} onError={onError} />
    </>)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'view-second-expert', visible: false })
    })
    view.rerender(<>
      <ExpertWebview launch={launch} visible={false} onError={onError} />
      <ExpertWebview launch={second} visible onError={onError} />
    </>)
    expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'view-geology-analysis', visible: false })
    expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'view-second-expert', visible: true })
    expect(invoke.mock.calls.filter(([command]) => command === 'open_expert_webview')).toHaveLength(2)
    expect(invoke.mock.calls.filter(([command]) => command === 'close_expert_webview')).toHaveLength(0)
    view.unmount()
    expect(invoke).toHaveBeenCalledWith('close_expert_webview', { label: 'view-geology-analysis' })
    expect(invoke).toHaveBeenCalledWith('close_expert_webview', { label: 'view-second-expert' })
  })
  it('preserves the native session across equivalent launch objects and new error callbacks', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 100, width: 800, height: 560 } as DOMRect)
    let failBounds = false
    const invoke = vi.fn(async (command: string) => {
      if (command === 'set_expert_webview_bounds' && failBounds) throw new Error('bounds failed')
      return command === 'open_expert_webview' ? 'expert-view' : undefined
    })
    ;(window as Window & { __ZJUGIS_NATIVE_INVOKE__?: typeof invoke }).__ZJUGIS_NATIVE_INVOKE__ = invoke
    const previousError = vi.fn()
    const currentError = vi.fn()
    const view = render(<ExpertWebview launch={launch} visible onError={previousError} />)
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('set_expert_webview_bounds', expect.anything()) })
    view.rerender(<ExpertWebview launch={{ ...launch, name: '更新名称' }} visible onError={currentError} />)
    expect(invoke.mock.calls.filter(([command]) => command === 'open_expert_webview')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([command]) => command === 'close_expert_webview')).toHaveLength(0)
    failBounds = true
    document.dispatchEvent(new Event('scroll'))
    await waitFor(() => { expect(currentError).toHaveBeenCalledWith('bounds failed') })
    expect(previousError).not.toHaveBeenCalled()
    failBounds = false
    view.rerender(<ExpertWebview launch={{ ...launch, ticket: 'b'.repeat(64) }} visible onError={currentError} />)
    await waitFor(() => { expect(invoke.mock.calls.filter(([command]) => command === 'open_expert_webview')).toHaveLength(2) })
    expect(invoke).toHaveBeenCalledWith('close_expert_webview', { label: 'expert-view' })
    view.unmount()
  })

  it('opens a native child at the tab bounds and closes it on unmount', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 100, width: 800, height: 560 } as DOMRect)
    const invoke = vi.fn(async (command: string) => command === 'open_expert_webview' ? 'expert-geology-analysis-aaaaaaaaaaaaaaaa' : undefined)
    ;(window as Window & { __ZJUGIS_NATIVE_INVOKE__?: typeof invoke }).__ZJUGIS_NATIVE_INVOKE__ = invoke
    const onError = vi.fn()
    const view = render(<ExpertWebview launch={launch} visible onError={onError} />)
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('set_expert_webview_bounds', expect.objectContaining({ label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa', x: 20, y: 100, width: 800, height: 560 })) })
    expect(invoke).toHaveBeenCalledWith('open_expert_webview', expect.objectContaining({ key: launch.id, url: launch.url, ticket: launch.ticket }))
    const previousBounds = invoke.mock.calls.filter(([command]) => command === 'set_expert_webview_bounds').length
    document.dispatchEvent(new Event('scroll'))
    await waitFor(() => { expect(invoke.mock.calls.filter(([command]) => command === 'set_expert_webview_bounds').length).toBeGreaterThan(previousBounds) })
    view.rerender(<ExpertWebview launch={launch} visible={false} onError={onError} />)
    expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa', visible: false })
    view.rerender(<ExpertWebview launch={launch} visible onError={onError} />)
    expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa', visible: true })
    view.unmount()
    expect(invoke).toHaveBeenCalledWith('close_expert_webview', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa' })
  })

  it('closes a late-created native view after the Tab was unmounted', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 800, height: 560 } as DOMRect)
    let resolveOpen: ((value: string) => void) | undefined
    const invoke = vi.fn((command: string) => command === 'open_expert_webview'
      ? new Promise<string>((resolve) => { resolveOpen = resolve })
      : Promise.resolve(undefined))
    ;(window as Window & { __ZJUGIS_NATIVE_INVOKE__?: typeof invoke }).__ZJUGIS_NATIVE_INVOKE__ = invoke
    const view = render(<ExpertWebview launch={launch} visible onError={vi.fn()} />)
    expect(resolveOpen).toBeDefined()
    view.unmount()
    resolveOpen?.('expert-geology-analysis-aaaaaaaaaaaaaaaa')
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('close_expert_webview', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa' }) })
  })

  it('does not report a pending bounds failure after the Tab closes', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 800, height: 560 } as DOMRect)
    let rejectBounds: ((error: Error) => void) | undefined
    const invoke = vi.fn((command: string) => {
      if (command === 'set_expert_webview_bounds') return new Promise<unknown>((_resolve, reject) => { rejectBounds = reject })
      return Promise.resolve(command === 'open_expert_webview' ? 'expert-view' : undefined)
    })
    ;(window as Window & { __ZJUGIS_NATIVE_INVOKE__?: typeof invoke }).__ZJUGIS_NATIVE_INVOKE__ = invoke
    const onError = vi.fn()
    const view = render(<ExpertWebview launch={launch} visible onError={onError} />)
    await waitFor(() => { expect(rejectBounds).toBeDefined() })
    view.unmount()
    rejectBounds?.(new Error('late failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(onError).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('close_expert_webview', { label: 'expert-view' })
  })

  it('hides behind a separate modal and restores the child view when it closes', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 100, width: 800, height: 560 } as DOMRect)
    const invoke = vi.fn(async (command: string, _args?: unknown) => command === 'open_expert_webview' ? 'expert-geology-analysis-aaaaaaaaaaaaaaaa' : undefined)
    ;(window as Window & { __ZJUGIS_NATIVE_INVOKE__?: typeof invoke }).__ZJUGIS_NATIVE_INVOKE__ = invoke
    const view = render(<ExpertWebview launch={launch} visible onError={vi.fn()} />)
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa', visible: true }) })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    vi.spyOn(dialog, 'getClientRects').mockReturnValue([{ width: 500, height: 400 }] as unknown as DOMRectList)
    document.body.append(dialog)
    try {
      await waitFor(() => { expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa', visible: false }) })
      dialog.remove()
      await waitFor(() => {
        expect(invoke.mock.calls.filter(([command, args]) => command === 'set_expert_webview_visible' && (args as { visible: boolean }).visible)).toHaveLength(2)
      })
    } finally {
      dialog.remove()
      view.unmount()
    }
  })

  it('stays visible inside its own marketplace dialog', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 100, width: 800, height: 560 } as DOMRect)
    const invoke = vi.fn(async (command: string) => command === 'open_expert_webview' ? 'expert-geology-analysis-aaaaaaaaaaaaaaaa' : undefined)
    ;(window as Window & { __ZJUGIS_NATIVE_INVOKE__?: typeof invoke }).__ZJUGIS_NATIVE_INVOKE__ = invoke
    const dialog = document.createElement('div')
    dialog.className = 'dsh-skill-market-panel'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    vi.spyOn(dialog, 'getClientRects').mockReturnValue([{ width: 500, height: 400 }] as unknown as DOMRectList)
    document.body.append(dialog)
    try {
      const view = render(<ExpertWebview launch={launch} visible onError={vi.fn()} />, { container: dialog })
      await waitFor(() => { expect(invoke).toHaveBeenCalledWith('set_expert_webview_visible', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa', visible: true }) })
      expect(invoke).not.toHaveBeenCalledWith('set_expert_webview_visible', { label: 'expert-geology-analysis-aaaaaaaaaaaaaaaa', visible: false })
      view.rerender(<ExpertWebview launch={launch} visible={false} onError={vi.fn()} />)
      view.unmount()
    } finally {
      dialog.remove()
    }
  })
})
