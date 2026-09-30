// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as chinese from '../src/client/index.ts'

describe('Chinese interaction language pack', () => {
  it('uses official fallback dictionaries and restores the original language on unload', async () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    locale.setLocale('en')
    locale.register('conversation', 'zh', { 'todo.title': '任务', 'access.fullLabel': 'Full access' })
    locale.register('conversation', 'en', { 'todo.title': 'Tasks', 'access.fullLabel': 'Full access' })
    const fiber = await ctx.plugin(chinese)
    const t = locale.bind('conversation')
    const dynamicText = t as (key: string) => string
    expect(locale.getLocale().active).toBe('zh-CN')
    expect(t('todo.title')).toBe('任务')
    expect(t('access.fullLabel')).toBe('完全访问')
    expect(dynamicText('Workspace Write')).toBe('工作区写入')
    expect(dynamicText('Custom provider label')).toBe('Custom provider label')
    expect((locale.bind('model') as (key: string) => string)('High')).toBe('高')
    expect(locale.bind('session-log-download')('header.action')).toBe('会话日志')
    await fiber.dispose()
    expect(locale.getLocale().active).toBe('en')
    expect(t('access.fullLabel')).toBe('Full access')
    expect(locale.getLocale().locales.some(item => item.id === 'zh-CN')).toBe(false)
  })

  it('preserves a subsequent user language change', async () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    locale.setLocale('en')
    const fiber = await ctx.plugin(chinese)
    locale.setLocale('zh')
    await fiber.dispose()
    expect(locale.getLocale().active).toBe('zh')
  })
})
