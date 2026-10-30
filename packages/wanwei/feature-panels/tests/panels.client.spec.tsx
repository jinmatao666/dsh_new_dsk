// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelController, PanelAction, FeaturePanel } from '../src/client/panels.tsx'
import type { PanelActionProps, PanelController, PanelProps } from '../src/client/panels.tsx'

afterEach(cleanup)

async function mount(ctx: Context, id: string) {
  let controller!: PanelController
  const fiber = ctx.plugin({ apply(scope: Context) { controller = createPanelController(scope, id) } })
  await fiber.await()
  return { controller, dispose: () => fiber.dispose() }
}

describe('independent feature navigation', () => {
  it('closes an unavailable page even when opened outside the disabled sidebar action and restores the entry after recovery', async () => {
    const ctx = new Context()
    const feature = await mount(ctx, 'connectivity')
    let directInternet = true
    const props = { wide: true, title: 'fixture', subtitle: '', Icon: () => null,
      controller: feature.controller, requiresDirectInternet: true,
      useNetwork: (selector: (state: unknown) => boolean) => selector({ mode: 'intranet', directInternet }),
      renderContent: () => <p>content</p> } as unknown as PanelActionProps & PanelProps
    try {
      const view = render(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      act(() => { feature.controller.open() })
      expect(screen.getByRole('dialog')).toBeTruthy()
      directInternet = false
      view.rerender(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
      expect(screen.queryByRole('dialog')).toBeNull()
      act(() => { feature.controller.open() })
      expect(screen.queryByRole('dialog')).toBeNull()
      directInternet = true
      view.rerender(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      act(() => { screen.getByRole<HTMLButtonElement>('button', { name: 'fixture' }).click() })
      expect(screen.getByRole('dialog')).toBeTruthy()
    } finally { await feature.dispose() }
  })
  it('removes a disabled entry without a placeholder and closes its open page', async () => {
    const ctx = new Context()
    const feature = await mount(ctx, 'visibility')
    let visible = true
    const listeners = new Set<() => void>()
    const visibility = {
      getSnapshot: () => visible,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const props = { wide: true, title: 'fixture', subtitle: '', Icon: () => null, controller: feature.controller,
      visibility, requiresDirectInternet: false, useNetwork: () => false,
      renderContent: () => <p>content</p> } as unknown as PanelActionProps & PanelProps
    try {
      render(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      act(() => { feature.controller.open() })
      expect(screen.getByRole('dialog')).toBeTruthy()
      act(() => { visible = false; listeners.forEach((listener) => { listener() }) })
      expect(screen.queryByRole('button')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(feature.controller.isOpen()).toBe(false)
      act(() => { visible = true; listeners.forEach((listener) => { listener() }) })
      expect(screen.getByRole('button')).toBeTruthy()
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally { await feature.dispose() }
  })
  it('applies an optional body class for features that fill the panel height', async () => {
    const ctx = new Context()
    const feature = await mount(ctx, 'body-class')
    const props = {
      wide: true, title: 'fixture', subtitle: '', Icon: () => null, controller: feature.controller,
      requiresDirectInternet: false, useNetwork: () => false, bodyClassName: 'dsh-knowledge-host',
      renderContent: () => <p>content</p>,
    } as unknown as PanelActionProps & PanelProps
    try {
      render(<FeaturePanel {...props} />)
      act(() => { feature.controller.open() })
      expect(document.querySelector('.dsh-skill-market-body.dsh-knowledge-host')).toBeTruthy()
    } finally { await feature.dispose() }
  })

  it('switches between independent instances and leaves siblings usable after disposal', async () => {
    const ctx = new Context()
    const features = await Promise.all(['skills', 'experts', 'connectors', 'automations'].map(id => mount(ctx, id)))
    try {
      for (const feature of features) {
        feature.controller.open()
        expect(features.filter(item => item.controller.isOpen())).toEqual([feature])
      }
      await features[1]!.dispose()
      features[0]!.controller.open()
      expect(features[0]!.controller.isOpen()).toBe(true)
      features[1]!.controller.open()
      expect(features[1]!.controller.isOpen()).toBe(false)
      expect(features[0]!.controller.isOpen()).toBe(true)
      window.dispatchEvent(new CustomEvent('wanwei:auth-state', { detail: { authenticated: false } }))
      expect(features.every(item => !item.controller.isOpen())).toBe(true)
    } finally { for (const feature of features) await feature.dispose() }
  })

  it('contains subscriber failures and detaches event listeners on unload', async () => {
    const ctx = new Context()
    const removed = vi.spyOn(window, 'removeEventListener')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const feature = await mount(ctx, 'test')
    const observed = vi.fn()
    feature.controller.subscribe(() => { throw new Error('fixture') })
    feature.controller.subscribe(observed)
    try {
      feature.controller.open()
      expect(observed).toHaveBeenCalledWith({ open: true })
      expect(report).toHaveBeenCalledOnce()
      await feature.dispose()
      expect(removed.mock.calls.map(call => call[0])).toContain('wanwei:feature-open')
      expect(removed.mock.calls.map(call => call[0])).toContain('wanwei:auth-state')
      observed.mockClear()
      feature.controller.open()
      expect(observed).not.toHaveBeenCalled()
    } finally { await feature.dispose(); removed.mockRestore(); report.mockRestore() }
  })

  it.each([
    ['internet', true, undefined, false], ['intranet', true, undefined, true],
    ['intranet', true, false, true], ['intranet', true, true, false], ['intranet', false, false, false],
  ] as const)('applies mode %s and direct-internet policy %s with result %s', async (mode, requiresDirectInternet, directInternet, disabled) => {
    const ctx = new Context()
    const feature = await mount(ctx, 'policy')
    try {
      // The feature owns policy; the UI receives a selector hook from its slot injection.
      const props = { wide: true, title: 'fixture', Icon: () => null, controller: feature.controller,
        requiresDirectInternet,
        useNetwork: (selector: (state: unknown) => boolean) => selector({ mode, directInternet }),
      } as unknown as PanelActionProps
      render(<PanelAction {...props} />)
      expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(disabled)
      expect(screen.getByRole('button').title).toBe(disabled ? '当前网络环境不可达，请检查您的网络' : 'fixture')
      act(() => { screen.getByRole<HTMLButtonElement>('button').click() })
      expect(feature.controller.isOpen()).toBe(!disabled)
    } finally { await feature.dispose() }
  })
})
