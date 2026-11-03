import { afterAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

describe('model reference multiplier through the built desktop UI', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined

  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('renders provider metadata, preserves zero, and reloads an edited multiplier', async () => {
    scaffold = await launchWebScaffold({})
    const channel = process.env.DSH_TEST_BROWSER_CHANNEL
    browser = await chromium.launch(channel ? { channel } : {})
    const settings = settingsNamespace('llm-pi-ai')
    const provider = (displayMultiplier: number) => ({
      displayName: 'Model Server', api: 'openai-completions', baseURL: 'https://example.invalid/v1',
      models: [{ id: 'reference-model', name: '示例模型', displayMultiplier }, { id: 'zero-model', name: '零倍率模型', displayMultiplier: 0 }, { id: 'local-model', name: '自定义模型' }],
    })
    await scaffold.ctx.settings.update(settings, { providers: { 'reference-server': provider(0.375) } })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    page.setDefaultTimeout(10_000)
    await page.goto(scaffold.authenticatedUrl)
    const openModels = async (): Promise<void> => {
      await page.getByRole('button', { name: /选择模型/ }).click()
      await page.getByRole('menuitem', { name: /^模型/ }).click()
    }
    await openModels()
    await expect.poll(() => page.getByLabel('参考倍率 0.375 倍').textContent()).toBe('0.375×')
    expect(await page.getByLabel('参考倍率 0 倍').textContent()).toBe('0×')
    expect(await page.getByRole('menuitemradio', { name: '自定义模型', exact: true }).textContent()).toBe('自定义模型')
    await page.mouse.click(1400, 80)
    await page.getByRole('menu', { name: '模型与推理等级' }).waitFor({ state: 'hidden' })
    await scaffold.ctx.settings.update(settings, { providers: { 'reference-server': provider(0.5) } })
    await openModels()
    await expect.poll(() => page.getByLabel('参考倍率 0.5 倍').textContent()).toBe('0.5×')
    expect(await page.getByLabel('参考倍率 0.375 倍').count()).toBe(0)
  }, 120_000)
})
