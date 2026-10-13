// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { skillDisplayName, skillSessionPreparation, startSkillUse } from '../src/client/skill-use.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

afterEach(() => { localStorage.clear(); vi.useRealTimers() })

describe('marketplace skill handoff', () => {
  it('allocates at first send time, registers a normal Workspace and creates its Session once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 20, 15))
    const allocate = vi.fn(async () => 'persistent/workspaces/202610122016')
    const createWorkspace = vi.fn(async () => ({ workspaceId: 'workspace' as WorkspaceId } as WorkspaceView))
    const createSession = vi.fn(async () => 'session' as SessionId)
    const prepare = skillSessionPreparation({ create: createWorkspace }, { create: createSession }, allocate)
    expect(allocate).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(2026, 9, 12, 20, 16))
    await expect(prepare()).resolves.toBe('session')
    await prepare()
    expect(allocate).toHaveBeenCalledExactlyOnceWith('202610122016')
    expect(createWorkspace).toHaveBeenCalledExactlyOnceWith({ path: 'persistent/workspaces/202610122016' })
    expect(createSession).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace' })
  })

  it('leaves the previous conversation and never inherits its Workspace for the new skill draft', async () => {
    let current: string | undefined = 'old-session'
    const sessions = {
      clear: vi.fn(() => { current = undefined }),
      list: { getSnapshot: vi.fn(() => ({ current, byId: { 'old-session': { cwd: '/dshskills' } } })) },
      create: vi.fn(async () => 'new-session' as SessionId),
    }
    const allocate = vi.fn(async () => '/persistent/202610130930')
    const create = vi.fn(async () => ({ workspaceId: 'new-workspace' as WorkspaceId } as WorkspaceView))
    const input = { setStagedDraft: vi.fn() }
    const prepare = skillSessionPreparation({ create }, sessions, allocate)
    startSkillUse(sessions, input, 'images-to-pdf', '图片转 PDF', prepare)
    expect(current).toBeUndefined()
    expect(allocate).not.toHaveBeenCalled()
    await prepare()
    expect(sessions.list.getSnapshot).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ path: '/persistent/202610130930' })
    expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'new-workspace' })
  })

  it('retries registration against its original directory instead of creating another empty directory', async () => {
    const allocate = vi.fn(async () => 'persistent/workspace')
    const createWorkspace = vi.fn().mockRejectedValueOnce(new Error('registration failed'))
      .mockResolvedValue({ workspaceId: 'workspace' as WorkspaceId })
    const createSession = vi.fn(async () => 'session' as SessionId)
    const prepare = skillSessionPreparation({ create: createWorkspace }, { create: createSession }, allocate)
    await expect(prepare()).rejects.toThrow('registration failed')
    await prepare()
    expect(allocate).toHaveBeenCalledOnce()
    expect(createWorkspace).toHaveBeenNthCalledWith(2, { path: 'persistent/workspace' })
  })
  it('hands off first-send preparation without allocating a workspace', () => {
    const prepare = vi.fn()
    const setStagedDraft = vi.fn()
    startSkillUse({ clear: vi.fn() }, { setStagedDraft }, 'images-to-pdf', '图片转 PDF', prepare)
    expect(prepare).not.toHaveBeenCalled()
    expect(setStagedDraft).toHaveBeenCalledWith('/images-to-pdf', prepare)
  })
  it('stages an editable skill token and returns to the no-Session composer without submitting', () => {
    const clear = vi.fn()
    const setStagedDraft = vi.fn()
    startSkillUse({ clear }, { setStagedDraft }, 'office-meeting-minutes', '会议纪要')
    expect(setStagedDraft).toHaveBeenCalledWith('/office-meeting-minutes')
    expect(clear).toHaveBeenCalledOnce()
    expect(skillDisplayName('office-meeting-minutes')).toBe('会议纪要')
  })
})
