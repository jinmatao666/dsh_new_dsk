// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps a staged skill and its editable question in the same inline flow', () => {
  const style = document.createElement('style')
  style.textContent = '[data-composer-staged-prefix] { float: left; } [data-composer-input] { display: block; }\n'
    + readFileSync('packages/wanwei/skill-marketplace/src/client/marketplace.css', 'utf8')
  const fixture = document.createElement('div')
  fixture.innerHTML = '<span data-composer-staged-prefix><span class="dsh-skill-draft-prefix"><button class="dsh-skill-draft-open"><svg></svg><span>任务事项跟踪</span></button><button class="dsh-skill-draft-remove">×</button></span></span><div data-composer-input contenteditable="true">问题</div>'
  document.head.append(style)
  document.body.append(fixture)
  try {
    const prefix = getComputedStyle(fixture.firstElementChild!)
    const input = getComputedStyle(fixture.lastElementChild!)
    const chip = getComputedStyle(fixture.querySelector('.dsh-skill-draft-prefix')!)
    const label = getComputedStyle(fixture.querySelector('button span')!)
    expect({ float: prefix.cssFloat, display: prefix.display, gap: prefix.marginRight,
      inputDisplay: input.display, wrap: input.wordBreak, maxWidth: chip.maxWidth,
      ellipsis: label.textOverflow === 'ellipsis' }).toMatchInlineSnapshot(`
      {
        "display": "inline-block",
        "ellipsis": true,
        "float": "none",
        "gap": "6px",
        "inputDisplay": "inline",
        "maxWidth": "240px",
        "wrap": "break-all",
      }
    `)
    const remove = getComputedStyle(fixture.querySelector('.dsh-skill-draft-remove')!)
    expect(remove.position).not.toBe('absolute')
    expect(remove.marginRight).toBe('5px')
  } finally { fixture.remove(); style.remove() }
})
