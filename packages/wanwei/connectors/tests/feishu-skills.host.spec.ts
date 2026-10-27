import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry from '../../../skill/skill/src/index.ts'
import * as SkillFilesystem from '../../../skill/skill-filesystem/src/index.ts'
import { installFeishuSkills, removeFeishuSkills } from '../src/feishu-skills.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'feishu-skills-'))
  roots.push(root)
  const source = join(root, 'bundled')
  const home = join(root, 'product')
  mkdirSync(join(source, 'lark-calendar', 'references'), { recursive: true })
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({ version: '1.0.98', names: ['lark-calendar'] }))
  writeFileSync(join(source, 'lark-calendar', 'SKILL.md'), '---\nname: lark-calendar\ndescription: 飞书日历\n---\n# Official calendar\nRead references/events.md.\n')
  writeFileSync(join(source, 'lark-calendar', 'references', 'events.md'), 'Official event reference\n')
  return { root, source, home }
}

it('loads the installed official skill through a Loader-composed filesystem provider', async () => {
  const { root, home, source } = fixture()
  installFeishuSkills(home, source)
  const ctx = new Context()
  try {
    const config = join(root, 'cordis.yml')
    writeFileSync(config, '- name: skills\n- name: filesystem\n  config:\n    includeDefaultRoots: false\n    watch: false\n    customSkillDirs: ' + JSON.stringify([join(home, 'skills')]) + '\n')
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (name === 'skills') return SkillRegistry
      if (name === 'filesystem') return SkillFilesystem
      throw new Error(`Unexpected plugin ${name}`)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['lark-calendar'])
    const skill = await ctx.skills.get('lark-calendar')
    expect(skill?.content).toContain('# Official calendar')
    expect(skill?.content).toContain('feishu_cli')
    expect(skill?.content).toContain('退出码 10')
    expect(skill?.content).toMatchSnapshot()
    expect(readFileSync(join(home, 'skills/lark-calendar/references/events.md'), 'utf8')).toBe('Official event reference\n')
    installFeishuSkills(home, source)
    expect((await ctx.skills.get('lark-calendar'))?.content).toBe(skill?.content)
  } finally { await ctx.fiber.dispose() }
})

it('unbind removes owned skills and preserves unrelated lark skills', () => {
  const { home, source } = fixture()
  installFeishuSkills(home, source)
  mkdirSync(join(home, 'skills/lark-custom'), { recursive: true })
  writeFileSync(join(home, 'skills/lark-custom/SKILL.md'), 'user content')
  removeFeishuSkills(home)
  expect(existsSync(join(home, 'skills/lark-calendar'))).toBe(false)
  expect(readFileSync(join(home, 'skills/lark-custom/SKILL.md'), 'utf8')).toBe('user content')
  removeFeishuSkills(home)
})

it('rejects path escapes, incomplete bundles and collisions without overwriting user files', () => {
  const { home, source } = fixture()
  mkdirSync(join(home, 'skills/lark-calendar'), { recursive: true })
  writeFileSync(join(home, 'skills/lark-calendar/SKILL.md'), 'user content')
  expect(() => installFeishuSkills(home, source)).toThrow('占用')
  expect(readFileSync(join(home, 'skills/lark-calendar/SKILL.md'), 'utf8')).toBe('user content')
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({ version: '1', names: ['../escape'] }))
  expect(() => installFeishuSkills(home, source)).toThrow('清单无效')
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({ version: '1', names: ['lark-missing'] }))
  expect(() => installFeishuSkills(home, source)).toThrow('不完整')
})
