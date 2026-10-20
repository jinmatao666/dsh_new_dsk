/** Real-browser regression for the catalog's viewport and scroll ownership. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const source = await readFile(new URL('../src/client/plugin.tsx', import.meta.url), 'utf8')
assert.ok(source.includes('className="dsh-skill-market-panel dsh-skill-market-catalog-panel"'))
const shared = await readFile(new URL('../../feature-panels/src/client/panels.css', import.meta.url), 'utf8')
const catalog = await readFile(new URL('../src/client/marketplace.css', import.meta.url), 'utf8')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  for (const height of [600, 900]) {
    const page = await browser.newPage({ viewport: { width: 1200, height } })
    // Load shared CSS last to prove that the catalog rule does not depend on bundle order.
    await page.setContent(`<style>${catalog}\n${shared}
      html,body{margin:0;height:100%;overflow:hidden}
      .fixture-section{height:480px;flex:none}
      </style><div class="dsh-skill-market-overlay">
      <main tabindex="0" class="dsh-skill-market-panel dsh-skill-market-catalog-panel">
      <header class="dsh-skill-market-header"><h1>技能市场</h1></header>
      <section class="fixture-section">推荐技能</section>
      <section class="fixture-section">平台技能</section>
      <section class="fixture-section">SkillHub</section>
      <button id="last">底部技能</button></main></div>`)
    const panel = page.locator('main')
    assert.ok(await panel.evaluate(el => el.scrollHeight > el.clientHeight))
    // Negative control reproduces the shared overflow:hidden rule used by the broken page.
    await panel.evaluate(el => el.classList.remove('dsh-skill-market-catalog-panel'))
    await panel.hover()
    await page.mouse.wheel(0, 250)
    await page.waitForTimeout(150)
    assert.equal(await panel.evaluate(el => el.scrollTop), 0)
    await panel.evaluate(el => el.classList.add('dsh-skill-market-catalog-panel'))
    await page.mouse.wheel(0, 350)
    await page.waitForFunction(() => document.querySelector('main').scrollTop > 0)
    await panel.focus()
    await page.keyboard.press('Control+End')
    await page.waitForFunction(() => {
      const el = document.querySelector('main')
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    })
    assert.equal(await page.evaluate(() => document.documentElement.scrollTop), 0)
    await page.keyboard.press('Control+Home')
    await page.waitForFunction(() => document.querySelector('main').scrollTop === 0)
    assert.equal(await page.locator('.fixture-section').first().evaluate(el => el.getBoundingClientRect().height), 480)
    console.log(`PASS ${height}px: wheel, keyboard, bottom reachability and uncompressed sections`)
    await page.close()
  }
} finally { await browser.close() }
