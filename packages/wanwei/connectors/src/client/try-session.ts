import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Lazily create (or reuse) a Workspace Session for connector「去试试」first send.
 * Matches skill-marketplace: allocate only when the user submits, not when staging.
 * @param workspaces - persisted Workspace API.
 * @param sessions - Session create API.
 * @param allocate - desktop automatic workspace path allocator.
 * @param selected - existing Workspace when the user already has one selected.
 * @returns preparation callback for `conversation.input.setStagedDraft`.
 */
export function connectorSessionPreparation(
  workspaces: Pick<IWorkspaces, 'create'>,
  sessions: Pick<ISessions, 'create'>,
  allocate: (name: string) => Promise<string>,
  selected?: WorkspaceId,
): () => Promise<SessionId> {
  let prepared: Promise<SessionId> | undefined
  let automaticPath: string | undefined
  return () => {
    prepared ??= (async () => {
      if (selected !== undefined) return sessions.create({ workspaceId: selected })
      const now = new Date()
      const name = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
        .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('')
      automaticPath ??= await allocate(name)
      const workspace = await workspaces.create({ path: automaticPath })
      return sessions.create({ workspaceId: workspace.workspaceId })
    })().catch((error: unknown) => {
      prepared = undefined
      throw error
    })
    return prepared
  }
}

type DesktopBridge = { core?: { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> } }
type DesktopInternals = { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> }

/**
 * Invoke a Wanwei desktop Tauri command.
 * @param command - native command name.
 * @param argumentsValue - command payload.
 * @returns native result.
 */
export function desktopInvoke(command: string, argumentsValue: unknown): Promise<unknown> {
  const desktopWindow = window as Window & { __TAURI__?: DesktopBridge; __TAURI_INTERNALS__?: DesktopInternals }
  const invoke = desktopWindow.__TAURI__?.core?.invoke ?? desktopWindow.__TAURI_INTERNALS__?.invoke
  if (typeof invoke !== 'function') {
    return Promise.reject(new Error('未连接到桌面端原生服务。请重新打开万维Buddy 后重试。'))
  }
  return invoke(command, argumentsValue)
}
