// @vitest-environment jsdom
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import * as clientPlugin from '../src/client/index.ts'
import { DesktopUpdateSection, DesktopUpdateOverlay } from '../src/client/DesktopUpdateSection.tsx'
import { DesktopUpdateController } from '../src/client/desktop-update-controller.ts'
import { zh } from '../src/client/locales.ts'

it('loads the real client registrations and shares one monitor across the version page and shell overlay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wanwei-update-settings-'))
  const ctx = new Context()
  const bridge = window as Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string) => Promise<unknown> }
  const state = { configured: true, automatic: true, currentVersion: '2.1.1', phase: 'idle', message: '', received: 10, total: 100,
    completed: null as null | { version: string; sha256: string; notes: string; dismissed: boolean } }
  const native = vi.fn(async (command: string) => {
    if (command === 'desktop_update_check') state.phase = 'downloading'
    if (command === 'desktop_update_dismiss') state.completed = null
    return { ...state }
  })
  bridge.__ZJUGIS_NATIVE_INVOKE__ = native
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
  try {
    const config = join(directory, 'cordis.yml')
    await writeFile(config, '- name: slots\n- name: services\n- name: updates\n- name: frame\n')
    ctx.baseUrl = `${pathToFileURL(directory).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['slots', SlotRegistry], ['updates', clientPlugin],
      ['services', { apply(scope: Context) {
        scope.provide('locale', new LocaleRuntime(scope))
        scope.provide('connection', { rpc: { call: vi.fn() } })
      } }],
      ['frame', { inject: ['slots'], apply(scope: Context) {
        scope.slots.register({ name: 'root', children: {
          'settings.section': { kind: 'list', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' },
        } }, (_props: PropsRenderSlots<'settings.section' | 'shell.overlay'>) => null)
      } }],
    ])
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (!modules.has(name)) throw new Error(`Unexpected fixture plugin: ${name}`)
      return modules.get(name)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    const version = ctx.slots.entries('settings.section').find(entry => entry.options.id === 'wanwei-version')
    const account = ctx.slots.entries('settings.section').find(entry => entry.options.id === 'wanwei-account')
    const overlay = ctx.slots.entries('shell.overlay').find(entry => entry.options.id === 'wanwei-update-progress')
    expect(version?.component).toBe(DesktopUpdateSection)
    expect(overlay?.component).toBe(DesktopUpdateOverlay)
    expect(version?.options.order).toBeLessThan(account?.options.order ?? 0)
    const updates = version?.inject?.().updates
    if (!(updates instanceof DesktopUpdateController)) throw new Error('Version monitor missing')
    expect(overlay?.inject?.().updates).toBe(updates)
    const t = makeTranslate(zh, commonZh)
    const settings = render(<DesktopUpdateSection updates={updates} t={t} />)
    render(<DesktopUpdateOverlay updates={updates} t={t} />)
    await screen.findByText('2.1.1')
    await act(async () => { await updates.check() })
    expect(screen.getByRole('dialog').textContent).toContain('10%')
    settings.unmount()
    expect(screen.getByRole('dialog')).toBeTruthy()
    updates.showProgress(false)
    state.completed = { version: '2.1.1', sha256: 'c'.repeat(64), notes: '同版本修复文件引用', dismissed: false }
    await act(async () => { await updates.setAutomatic(true) })
    const completed = await screen.findByRole('dialog', { name: zh.updatesCompletedTitle })
    expect(completed.textContent).toContain('同版本修复文件引用')
    fireEvent.click(screen.getByRole('button', { name: zh.updatesCompletedClose }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  } finally {
    cleanup()
    await ctx.fiber.dispose()
    delete bridge.__ZJUGIS_NATIVE_INVOKE__
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
