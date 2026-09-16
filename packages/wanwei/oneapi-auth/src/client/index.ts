/** Browser half of Wanwei desktop authentication. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AccountSection, type AccountInjected } from './AccountSection.tsx'
import { AuthGate, type AuthInjected } from './AuthGate.tsx'
import { AuthController } from './controller.ts'
import { en, zh, type WanweiAuthKey } from './locales.ts'

export type { WanweiAuthKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'wanwei.auth': WanweiAuthKey
  }
}

const NS = 'wanwei.auth'

export const inject = ['slots', 'connection', 'locale']

/** Install the login gate and account settings entry over one shared controller. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wanwei-auth: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new AuthController(connection)
  const authInject = (): AuthInjected => ({
    hooks: { auth: controller },
    refresh: signal => controller.refresh(signal),
    login: (username, password, signal) => controller.login(username, password, signal),
    fail: (error) => { controller.fail(error) },
  })
  const accountInject = (): AccountInjected => ({
    hooks: { auth: controller },
    logout: () => controller.logout(),
  })
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'wanwei-auth', order: -1000, locale: NS, inject: authInject,
  }, AuthGate))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'wanwei-account', order: 40, label: () => t('accountNav'), locale: NS, inject: accountInject,
  }, AccountSection))
}
