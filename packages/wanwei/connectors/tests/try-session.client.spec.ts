// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { connectorSessionPreparation, createAutomaticWorkspace, automaticWorkspaceName, stageConnectorExample } from '../src/client/try-session.ts'

describe('connectorSessionPreparation', () => {
  it('allocates a workspace only on first send', async () => {
    const createWorkspace = vi.fn(async () => ({ workspaceId: 'ws-1' as WorkspaceId } as WorkspaceView))
    const createSession = vi.fn(async () => 'session-1' as SessionId)
    const allocate = vi.fn(async () => 'persistent/workspaces/202610191645')
    const prepare = connectorSessionPreparation(
      { create: createWorkspace },
      { create: createSession },
      allocate,
    )
    expect(allocate).not.toHaveBeenCalled()
    await expect(prepare()).resolves.toBe('session-1')
    expect(allocate).toHaveBeenCalledOnce()
    expect(createWorkspace).toHaveBeenCalledWith({ path: 'persistent/workspaces/202610191645' })
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    await expect(prepare()).resolves.toBe('session-1')
    expect(allocate).toHaveBeenCalledOnce()
  })

  it('reuses a selected workspace without allocating', async () => {
    const createWorkspace = vi.fn()
    const createSession = vi.fn(async () => 'session-2' as SessionId)
    const allocate = vi.fn(async () => 'unused')
    await connectorSessionPreparation(
      { create: createWorkspace },
      { create: createSession },
      allocate,
      'selected' as WorkspaceId,
    )()
    expect(allocate).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'selected' })
  })
})

it('uses the native allocator timestamp contract and reuses its collision handling', async () => {
  expect(automaticWorkspaceName(new Date(2026, 9, 30, 8, 4, 5))).toBe('20261030080405')
  const invoke = vi.fn<(command: string, args: { name: string }) => Promise<string>>(async () => 'C:\\workspaces\\20261030080405 (2)')
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: { invoke } })
  try {
    await expect(createAutomaticWorkspace()).resolves.toBe('C:\\workspaces\\20261030080405 (2)')
    expect(invoke.mock.calls[0]?.[0]).toBe('create_automatic_workspace')
    expect(invoke.mock.calls[0]?.[1].name).toMatch(/^\d{14}$/)
  } finally { Reflect.deleteProperty(window, '__TAURI_INTERNALS__') }
})

it('stages a fresh conversation and defers workspace and Session creation until send', async () => {
  const staged = vi.fn<(text: string, prepare?: () => Promise<SessionId>) => void>()
  const createWorkspace = vi.fn(async () => ({ workspaceId: 'fresh-workspace' as WorkspaceId } as WorkspaceView))
  const createSession = vi.fn(async () => 'fresh-session' as SessionId)
  const clear = vi.fn()
  const allocate = vi.fn(async () => 'new-workspace')
  stageConnectorExample('查看我的飞书日程', { setStagedDraft: staged }, { create: createWorkspace }, { create: createSession, clear }, allocate)
  expect(clear).toHaveBeenCalledOnce()
  expect(staged.mock.calls[0]?.[0]).toBe('查看我的飞书日程')
  expect(createSession).not.toHaveBeenCalled()
  expect(createWorkspace).not.toHaveBeenCalled()
  expect(allocate).not.toHaveBeenCalled()
  const prepare = staged.mock.calls[0]?.[1]
  if (!prepare) throw new Error('missing deferred Session preparation')
  await expect(prepare()).resolves.toBe('fresh-session')
  expect(createSession).toHaveBeenCalledWith({ workspaceId: 'fresh-workspace' })
})
