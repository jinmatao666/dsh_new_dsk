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

  it('retains an existing selected Workspace without allocating or registering another one', async () => {
    const allocate = vi.fn(async () => 'unused')
    const createWorkspace = vi.fn()
    const createSession = vi.fn(async () => 'session' as SessionId)
    await skillSessionPreparation({ create: createWorkspace }, { create: createSession }, allocate, 'selected' as WorkspaceId)()
    expect(allocate).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'selected' })
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
