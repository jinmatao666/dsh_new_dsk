// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PanelController } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import { apply } from '../src/client/plugin.tsx'

afterEach(() => { cleanup(); localStorage.clear() })

it('restores backend order on reopen and fetches changed ordering through Refresh catalog', async () => {
  let skills = [
    { id: 1, name: 'first-skill', display_name: '后台首位技能', downloads: 1 },
    { id: 2, name: 'second-skill', display_name: '下载更多技能', downloads: 99 },
  ]
  const call = vi.fn(async (_path: string, operation: string) => ({ ok: true, value: {
    items: operation === 'skill-list' ? skills : [],
  } }))
  let overlay: { Component: ComponentType<Record<string, unknown>>; props: Record<string, unknown> } | undefined
  const ctx = {
    effect: () => {},
    get: (name: string) => name === 'connection' ? { rpc: { call } } : {},
    wanweiNetwork: { catalogAccess: () => 'available' },
    remote: { directoryPicker: { pick: vi.fn() } },
    slots: {
      inject: (_name: string, callback: () => void) => callback(),
      register: (options: { name: string; inject?: () => Record<string, unknown> }, Component: ComponentType<Record<string, unknown>>) => {
        if (options.name === 'shell.overlay') overlay = { Component, props: options.inject!() }
        return () => {}
      },
    },
  } as unknown as Context
  apply(ctx)
  if (!overlay) throw new Error('Marketplace overlay not registered')
  const { Component, props } = overlay
  const controller = props.controller as PanelController
  const view = render(<Component {...props} useNetwork={(select: (state: unknown) => unknown) => select({ mode: 'internet', directInternet: true })} />)
  const names = () => [...view.container.querySelectorAll('.dsh-skill-card h2')].map(node => node.textContent)
  await act(async () => { controller.open() })
  await screen.findByRole('heading', { name: '后台首位技能', level: 2 })
  await waitFor(() => { expect(names()).toEqual(['后台首位技能', '下载更多技能']) })
  const sort = () => screen.getByRole('combobox', { name: '搜索平台技能 / 热门下载' })
  fireEvent.click(sort())
  fireEvent.click(screen.getByRole('option', { name: '热门下载' }))
  expect(names()).toEqual(['下载更多技能', '后台首位技能'])
  await act(async () => { controller.close(); controller.open() })
  await waitFor(() => { expect(names()).toEqual(['后台首位技能', '下载更多技能']) })
  expect(sort().textContent).toContain('默认顺序')
  skills = [...skills].reverse()
  fireEvent.click(screen.getByRole('button', { name: '刷新目录' }))
  await waitFor(() => { expect(names()).toEqual(['下载更多技能', '后台首位技能']) })
  expect(sort().textContent).toContain('默认顺序')
  expect(call.mock.calls.filter(([, operation]) => operation === 'skill-list')).toHaveLength(3)
})
