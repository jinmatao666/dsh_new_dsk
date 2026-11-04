import { CreditsSection, CheckinShortcut, type CreditsInjected } from './CreditsSection.tsx'
/** Browser half of Wanwei desktop authentication. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { AccountSection, type AccountInjected } from './AccountSection.tsx'
import { DesktopUpdateSection, DesktopUpdateOverlay } from './DesktopUpdateSection.tsx'
import { DesktopUpdateController } from './desktop-update-controller.ts'
import { AuthGate, type AuthInjected } from './AuthGate.tsx'
import { AuthController } from './controller.ts'
import { NetworkController } from './network-controller.ts'
import { NetworkGuard } from './NetworkGuard.tsx'
import { ManagedProviderCatalog } from './ManagedProviderCatalog.tsx'
export type { NetworkController } from './network-controller.ts'
export type { NetworkState, NetworkEnvironment } from '../network-contract.ts'
declare module '@deepseek-ai/cordis' {
  interface Context { wanweiNetwork: NetworkController }
}
import { en, zh } from './locales.ts'

export type { WanweiAuthKey } from './locales.ts'

const NS = 'wanwei.auth'

export const inject = ['slots', 'connection', 'locale']

/** Install the login gate and account settings entry over one shared controller. */
export function apply(ctx: Context): void {
  ctx.provide('modelSettingsPolicy', { managedProvider: 'dsh-server', customOnly: true })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wanwei-auth: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new AuthController(connection)
  const network = new NetworkController(connection)
  ctx.provide('wanweiNetwork', network)
  const authInject = (): AuthInjected => ({
    hooks: { auth: controller },
    getSupportContact: async () => {
      const result = await connection.rpc.call('/desktop-auth', 'deployment-get', {})
      if (!result.ok) throw new Error(result.error.message)
      return result.value as import('../deployment.ts').DeploymentSettings
    },
    refresh: async (signal) => { await network.refresh(signal); return controller.refresh(signal) },
    login: async (username, password, signal) => { await network.refresh(signal); return controller.login(username, password, signal) },
    requestAccount: async (operation, input = {}) => {
      const result = await connection.rpc.call('/desktop-auth', 'account-security', { operation, input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    publicAuth: (operation, input, signal) => controller.publicAuth(operation, input, signal),
    fail: (error) => { controller.fail(error) },
  })
  const accountInject = (): AccountInjected => ({
    hooks: { auth: controller },
    logout: () => controller.logout(),
    requestAccount: async (operation, input = {}) => {
      const result = await connection.rpc.call('/desktop-auth', 'account-security', { operation, input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  })
  const requestCredits: CreditsInjected['requestCredits'] = async (operation, page = 0, filter = 'all') => {
    const result = await connection.rpc.call('/desktop-auth', 'credits', { operation, page, filter })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const creditsInject = (): CreditsInjected => ({ hooks: { auth: controller }, requestCredits })
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'wanwei-credits', order: 38, label: () => '积分与用量', inject: creditsInject }, CreditsSection))
  ctx.slots.inject('settings.shortcut', () => ctx.slots.register({ name: 'settings.shortcut', id: 'wanwei-checkin', inject: creditsInject }, CheckinShortcut))
  const t = ctx.locale.bind(NS)
  const updates = new DesktopUpdateController((window as Window & {
    __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown>
  }).__ZJUGIS_NATIVE_INVOKE__)
  ctx.effect(() => updates.start(), 'wanwei-auth: update monitor')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'wanwei-update-progress', order: 200, locale: NS, inject: () => ({ updates }),
  }, DesktopUpdateOverlay))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'wanwei-network-guard', order: -999, locale: NS, inject: () => ({ hooks: { network } }),
  }, NetworkGuard))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'wanwei-auth', order: -1000, locale: NS, inject: authInject,
  }, AuthGate))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'wanwei-account', order: 40, label: () => t('accountNav'), locale: NS, inject: accountInject,
  }, AccountSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'wanwei-version', order: 35, label: () => t('updatesNav'), locale: NS,
    inject: () => ({ updates }),
  }, DesktopUpdateSection))
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: 'llm-pi-ai',
    locale: NS, inject: () => ({ hooks: { auth: controller } }),
  }, ManagedProviderCatalog))
}
