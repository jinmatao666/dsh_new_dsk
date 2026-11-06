// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelController, FeaturePanel, PanelAction } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { PanelActionProps, PanelController, PanelProps } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { PortalPage } from '../src/client/plugin.tsx'
import { productText } from '../src/client/locales/product.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function observable<T>(value: T): HostObservable<T> & { set(next: T): void } {
  let current = value
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      current = next
      for (const listener of listeners) listener()
    },
  }
}

async function mount(ctx: Context, id: string) {
  let controller!: PanelController
  const fiber = ctx.plugin({ apply(scope: Context) { controller = createPanelController(scope, id) } })
  await fiber.await()
  return { controller, dispose: () => fiber.dispose() }
}

describe('portal feature panels', () => {
  it('hides the entry when disabled and embeds the configured page when enabled', async () => {
    const ctx = new Context()
    const feature = await mount(ctx, 'skill-land-market')
    const visibility = observable(false)
    const url = observable('')
    const props = {
      wide: true,
      title: productText('土地市场'),
      subtitle: productText('浏览配置的土地市场页面'),
      Icon: () => null,
      controller: feature.controller,
      visibility,
      requiresDirectInternet: false,
      useNetwork: () => false,
      bodyClassName: 'dsh-portal-host',
      headerChrome: 'back-only',
      renderContent: () => <PortalPage url={url} />,
    } as unknown as PanelActionProps & PanelProps
    try {
      const view = render(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      expect(screen.queryByRole('button', { name: productText('土地市场') })).toBeNull()
      act(() => { visibility.set(true) })
      view.rerender(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      expect(screen.getByRole('button', { name: productText('土地市场') })).toBeTruthy()
      act(() => { feature.controller.open() })
      expect(document.querySelector('.dsh-skill-market-heading')).toBeNull()
      expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
      expect(screen.getByRole('status').textContent).toContain('请先在管理工作台配置页面地址')
      act(() => { url.set('https://land.example/#/home') })
      view.rerender(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      expect(screen.getByTitle('https://land.example/#/home')).toBeTruthy()
      expect((screen.getByTitle('https://land.example/#/home') as HTMLIFrameElement).src)
        .toBe('https://land.example/#/home')
      expect(screen.getByRole('status', { name: productText('正在加载…') })).toBeTruthy()
      act(() => { fireEvent.load(screen.getByTitle('https://land.example/#/home')) })
      expect(screen.queryByRole('status', { name: productText('正在加载…') })).toBeNull()
    } finally {
      await feature.dispose()
    }
  })

  it('shows the loading mark again when the configured URL changes', () => {
    const url = observable('https://land.example/a')
    const view = render(<PortalPage url={url} />)
    expect(screen.getByRole('status', { name: productText('正在加载…') })).toBeTruthy()
    act(() => { fireEvent.load(screen.getByTitle('https://land.example/a')) })
    expect(screen.queryByRole('status', { name: productText('正在加载…') })).toBeNull()
    act(() => { url.set('https://land.example/b') })
    view.rerender(<PortalPage url={url} />)
    expect(screen.getByRole('status', { name: productText('正在加载…') })).toBeTruthy()
    expect(screen.getByTitle('https://land.example/b')).toBeTruthy()
  })
})
