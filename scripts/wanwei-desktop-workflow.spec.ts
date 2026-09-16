import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'

const workflowPath = resolve(import.meta.dirname, '..', '.github', 'workflows', 'wanwei-desktop-preview.yml')

function loadWorkflow(): Record<string, unknown> {
  const value: unknown = yaml.load(readFileSync(workflowPath, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Wanwei desktop preview workflow must contain an object')
  }
  return value as Record<string, unknown>
}

describe('Wanwei desktop preview workflow', () => {
  it('is manual-only and builds the isolated Windows preview product through the runner guard', () => {
    const workflow = loadWorkflow()
    expect(Object.keys(workflow.on as Record<string, unknown>)).toEqual(['workflow_dispatch'])
    const jobs = workflow.jobs as Record<string, Record<string, unknown>>
    const build = jobs['build-windows']
    expect(build?.['runs-on']).toBe('windows-2025')
    expect(build?.permissions).toEqual({ contents: 'read' })
    const steps = build?.steps as Array<Record<string, unknown>>
    const commands = steps.filter(step => typeof step.run === 'string').map(step => step.run).join('\n')
    expect(commands).toContain('products/wanwei-desktop run build:runner')
    expect(commands).toContain('--bundles nsis')
    expect(commands).toContain('wanwei-preview-artifacts')
  })

  it('publishes only an optional preview release and contains no service deployment job', () => {
    const workflow = loadWorkflow()
    const jobs = workflow.jobs as Record<string, Record<string, unknown>>
    expect(Object.keys(jobs)).toEqual(['build-windows', 'release'])
    expect(jobs.release?.if).toBe('${{ inputs.publish_github_release }}')
    const releaseSteps = jobs.release?.steps as Array<Record<string, unknown>>
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
})
