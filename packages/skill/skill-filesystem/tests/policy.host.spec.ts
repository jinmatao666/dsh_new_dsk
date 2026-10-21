import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { expect, it } from 'vitest'
import * as SkillFileSystem from '../src/index.ts'
import SkillFileSystemPolicy from '../src/policy.ts'

it('invalidates cached catalogs when a deployment policy mounts and disposes without deleting skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-policy-'))
  const ctx = new Context()
  try {
    const dshHome = join(root, 'home')
    const agentsHome = join(root, 'agents')
    const workspace = join(root, 'repository', 'workspace')
    await mkdir(join(root, 'repository', '.git'), { recursive: true })
    for (const [directory, name] of [
      [join(dshHome, 'skills'), 'installed'],
      [join(agentsHome, 'skills'), 'external'],
      [join(root, 'repository', '.dsh', 'skills'), 'parent'],
      [join(workspace, '.dsh', 'skills'), 'workspace'],
    ] as const) {
      await mkdir(join(directory, name), { recursive: true })
      await writeFile(join(directory, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\nBody.\n`)
    }
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome, agentsHome, watch: false })
    const names = async () => (await ctx.skills.list({ cwd: workspace })).map(skill => skill.name)
    expect(await names()).toEqual(['external', 'installed', 'parent'])
    const policy = ctx.plugin(SkillFileSystemPolicy, { projectRootMode: 'cwd', includeUserAgentsRoot: false })
    await policy
    expect(await names()).toEqual(['installed', 'workspace'])
    expect(await ctx.skills.get('external', { cwd: workspace })).toBeUndefined()
    await policy.dispose()
    expect(await names()).toEqual(['external', 'installed', 'parent'])
    expect(await readFile(join(agentsHome, 'skills', 'external', 'SKILL.md'), 'utf8')).toContain('name: external')
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
