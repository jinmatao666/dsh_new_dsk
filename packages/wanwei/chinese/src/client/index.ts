/** Browser language pack; no DOM replacement, model-output rewriting or storage scanning. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { dictionaries } from './dictionaries.ts'

export const inject = ['locale']

/**
 * Register a Chinese pack over the official zh dictionaries and restore selection on unload.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const locale = ctx.locale
  const previous = locale.getLocale().active
  ctx.effect(() => locale.addLanguage({ id: 'zh-CN', label: '中文（对话适配）', fallback: 'zh' }),
    'wanwei-chinese: language')
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => locale.register(namespace, 'zh-CN', dictionary), 'wanwei-chinese: dictionary')
  }
  locale.setLocale('zh-CN')
  ctx.effect(() => () => {
    if (locale.getLocale().active === 'zh-CN') locale.setLocale(previous === 'zh-CN' ? 'zh' : previous)
  }, 'wanwei-chinese: restore language')
}
