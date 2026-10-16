import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '../src/index.ts'

it('boots the shipped desktop skill discovery policy through Loader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-skill-roots-'))
  const ctx = new Context()
  try {
    const workspace = join(root, 'repository', 'workspace')
    const dshHome = join(root, 'desktop-home')
    const agentsHome = join(root, 'shared-agents')
    const customRoot = join(root, 'explicit-custom')
    await mkdir(join(root, 'repository', '.git'), { recursive: true })
    for (const [directory, name] of [
      [join(workspace, '.dsh', 'skills'), 'workspace-dsh'],
      [join(workspace, '.agents', 'skills'), 'workspace-agents'],
      [join(dshHome, 'skills'), 'market-installed'],
      [join(agentsHome, 'skills'), 'external-shared'],
      [join(root, 'repository', '.dsh', 'skills'), 'parent-repository'],
      [customRoot, 'explicit-custom'],
    ]) {
      const skillDir = join(directory!, name!)
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\nUse this skill.\n`)
    }
    const patches = parse(await readFile(new URL('../../../bundle/wanwei-desktop/cordis.patch.yml', import.meta.url), 'utf8'), {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
    }) as Array<{ id?: string; config?: SkillFileSystem.Config }>
    const desktop = patches.find(patch => patch.id === 'skill-filesystem')
    expect(desktop?.config).toEqual({ projectRootMode: 'cwd', includeUserAgentsRoot: false })
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, stringify([
      { name: 'test-skills' },
      { name: 'test-filesystem', config: {
        projectRootMode: desktop!.config!.projectRootMode,
        includeUserAgentsRoot: desktop!.config!.includeUserAgentsRoot,
        dshHome, agentsHome, customSkillDirs: [customRoot], watch: false,
      } },
    ]))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([['test-skills', SkillRegistry], ['test-filesystem', SkillFileSystem]])
    ctx.loader.internal = {
      version: 'v2', async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected plugin ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect((await ctx.skills.list({ cwd: workspace })).map(skill => skill.name)).toMatchInlineSnapshot(`
      [
        "explicit-custom",
        "market-installed",
        "workspace-agents",
        "workspace-dsh",
      ]
    `)
    expect(await ctx.skills.get('external-shared', { cwd: workspace })).toBeUndefined()
    expect(await ctx.skills.get('parent-repository', { cwd: workspace })).toBeUndefined()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['explicit-custom', 'market-installed'])
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
