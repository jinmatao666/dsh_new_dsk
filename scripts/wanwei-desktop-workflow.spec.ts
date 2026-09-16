import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'

const workflowPath = resolve(import.meta.dirname, '..', '.github', 'workflows', 'wanwei-desktop-preview.yml')
const runnerConfigPath = resolve(import.meta.dirname, '..', 'products', 'wanwei-desktop', 'scripts', 'prepare-runner-config.mjs')

function loadWorkflow(): Record<string, unknown> {
  const value: unknown = yaml.load(readFileSync(workflowPath, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Wanwei desktop preview workflow must contain an object')
  }
  return value as Record<string, unknown>
}

describe('Wanwei desktop preview workflow', () => {
  it('is manual-only and builds isolated Windows, macOS, and Linux preview products', () => {
    const workflow = loadWorkflow()
    expect(Object.keys(workflow.on as Record<string, unknown>)).toEqual(['workflow_dispatch'])
    const jobs = workflow.jobs as Record<string, Record<string, unknown>>
    const build = jobs['build-desktop']
    expect(build?.['runs-on']).toBe('${{ matrix.runner }}')
    expect(build?.permissions).toEqual({ contents: 'read' })
    const strategy = build?.strategy as Record<string, unknown>
    const matrix = strategy.matrix as Record<string, unknown>
    expect(matrix.include).toEqual([
      { name: 'Windows x64', platform: 'windows-x64', runner: 'windows-2025', bundles: 'nsis' },
      { name: 'macOS arm64', platform: 'macos-arm64', runner: 'macos-15', bundles: 'dmg' },
      { name: 'Linux x64', platform: 'linux-x64', runner: 'ubuntu-22.04', bundles: 'deb,appimage' },
    ])
    const steps = build?.steps as Array<Record<string, unknown>>
    const commands = steps.filter(step => typeof step.run === 'string').map(step => step.run).join('\n')
    expect(commands).toContain('products/wanwei-desktop run build:runner')
    expect(commands).toContain('prepare-runner-config.mjs ${{ matrix.platform }}')
    expect(commands).toContain('libwebkit2gtk-4.1-dev')
    expect(commands).toContain('--bundles ${{ matrix.bundles }}')
    expect(JSON.stringify(steps)).toContain('bundle/nsis/*.exe')
    expect(JSON.stringify(steps)).toContain('bundle/dmg/*.dmg')
    expect(JSON.stringify(steps)).toContain('bundle/deb/*.deb')
    expect(JSON.stringify(steps)).toContain('bundle/appimage/*.AppImage')
  })

  it('publishes only an optional preview release and contains no service deployment job', () => {
    const workflow = loadWorkflow()
    const jobs = workflow.jobs as Record<string, Record<string, unknown>>
    expect(Object.keys(jobs)).toEqual(['build-desktop', 'release'])
    expect(jobs.release?.if).toBe('${{ inputs.publish_github_release }}')
    expect(jobs.release?.needs).toBe('build-desktop')
    const releaseSteps = jobs.release?.steps as Array<Record<string, unknown>>
    expect(releaseSteps[0]).toMatchObject({
      with: {
        pattern: 'wanwei-buddy-preview-${{ inputs.version }}-*',
        'merge-multiple': true,
      },
    })
    expect(releaseSteps.at(-1)).toMatchObject({
      with: {
        tag_name: 'wanwei-preview-v${{ inputs.version }}',
        prerelease: true,
      },
    })
    const workflowText = JSON.stringify(workflow).toLowerCase()
    for (const forbidden of ['docker', 'container', 'build-push-action', 'database', 'ssh-action']) {
      expect(workflowText).not.toContain(forbidden)
    }
  })

  it.each([
    ['windows-x64', 'Windows', false],
    ['macos-arm64', 'macOS', true],
    ['linux-x64', 'Linux', false],
  ] as const)('prepares a validated %s runner config', (platform, runnerOs, adHocSigning) => {
    const root = mkdtempSync(join(tmpdir(), 'wanwei-runner-config-'))
    try {
      const result = spawnSync(process.execPath, [runnerConfigPath, platform], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          RUNNER_OS: runnerOs,
          RUNNER_TEMP: root,
          DSH_RELEASE_VERSION: '0.2.0-preview.1',
          DSH_DESKTOP_SERVER_URL: 'https://oneapi.example.test',
        },
      })
      expect(result.status, result.stderr).toBe(0)
      const configPath = join(root, `wanwei-preview-${platform}.json`)
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      expect(config.version).toBe('0.2.0-preview.1')
      expect(config.bundle !== undefined).toBe(adHocSigning)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
