// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps a staged skill and its editable question in the same inline flow', () => {
  const style = document.createElement('style')
  style.textContent = '[data-composer-staged-prefix] { float: left; } [data-composer-input] { display: block; }\n'
    + readFileSync('packages/wanwei/skill-marketplace/src/client/marketplace.css', 'utf8')
  const fixture = document.createElement('div')
  fixture.innerHTML = '<span data-composer-staged-prefix><button class="dsh-skill-draft-prefix"><svg></svg><span>任务事项跟踪</span><span>×</span></button></span><div data-composer-input contenteditable="true">问题</div>'
  document.head.append(style)
  document.body.append(fixture)
  try {
    const prefix = getComputedStyle(fixture.firstElementChild!)
    const input = getComputedStyle(fixture.lastElementChild!)
    const chip = getComputedStyle(fixture.querySelector('button')!)
    const label = getComputedStyle(fixture.querySelector('button span')!)
    expect({ float: prefix.cssFloat, display: prefix.display, gap: prefix.marginRight,
      inputDisplay: input.display, wrap: input.wordBreak, maxWidth: chip.maxWidth,
      ellipsis: label.textOverflow === 'ellipsis' }).toMatchInlineSnapshot(`
      {
        "display": "inline",
        "ellipsis": false,
        "float": "none",
        "gap": "6px",
        "inputDisplay": "inline",
        "maxWidth": "none",
        "wrap": "break-all",
      }
    `)
  } finally { fixture.remove(); style.remove() }
})
