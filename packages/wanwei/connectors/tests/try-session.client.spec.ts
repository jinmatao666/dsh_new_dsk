// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { connectorSessionPreparation, createAutomaticWorkspace, automaticWorkspaceName } from '../src/client/try-session.ts'

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
