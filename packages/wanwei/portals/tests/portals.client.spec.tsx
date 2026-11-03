// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelController, FeaturePanel, PanelAction } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { PanelActionProps, PanelController, PanelProps } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore } from 'react'
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

function PortalPage({ url }: { url: HostObservable<string> }) {
  const href = useSyncExternalStore(url.subscribe, url.getSnapshot)
  if (!href) {
    return <div role="status">
      <h2>{productText('请先在管理工作台配置页面地址')}</h2>
      <p>{productText('管理员尚未配置此功能的页面地址，配置后即可在此查看。')}</p>
    </div>
  }
  return <iframe title={href} src={href} />
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
      renderContent: () => <PortalPage url={url} />,
    } as unknown as PanelActionProps & PanelProps
    try {
      const view = render(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      expect(screen.queryByRole('button', { name: productText('土地市场') })).toBeNull()
      act(() => { visibility.set(true) })
      view.rerender(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      expect(screen.getByRole('button', { name: productText('土地市场') })).toBeTruthy()
      act(() => { feature.controller.open() })
      expect(screen.getByRole('status').textContent).toContain('请先在管理工作台配置页面地址')
      act(() => { url.set('https://land.example/#/home') })
      view.rerender(<><PanelAction {...props} /><FeaturePanel {...props} /></>)
      expect(screen.getByTitle('https://land.example/#/home')).toBeTruthy()
      expect((screen.getByTitle('https://land.example/#/home') as HTMLIFrameElement).src)
        .toBe('https://land.example/#/home')
    } finally {
      await feature.dispose()
    }
  })
})
