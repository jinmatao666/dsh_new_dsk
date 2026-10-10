/** Browser-owned settings contribution; no imports from the host browser provider. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import { BrowserCard, type BrowserPreference } from './BrowserCard.tsx'
import { zh, en } from './locales.ts'

/** Settings and network services consumed by the card. */
export const inject = ['slots', 'locale', 'settingsScope', 'wanweiNetwork']
/** Register the browser card through the existing settings extension point.
 * @param ctx - client services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('wanwei.browser', { zh, en }))
  const scope = ctx.settingsScope.bind<BrowserPreference>({ namespace: 'wanwei-browser-use' })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: 'wanwei-browser-use', locale: 'wanwei.browser',
    inject: () => ({ hooks: { preference: scope, network: ctx.wanweiNetwork },
      setEnabled: (enabled: boolean) => scope.set('enabled', enabled) }),
  }, BrowserCard))
}
