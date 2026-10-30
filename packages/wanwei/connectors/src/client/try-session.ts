import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
      const name = automaticWorkspaceName()
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

/** Use the existing connector workspace naming convention, in local time.
 * @param now - Local creation time.
 * @returns Year, month, day, hour and minute and second without separators.
 */
export function automaticWorkspaceName(now: Date = new Date()): string {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('')
}

/** Allocate a directory through the desktop's existing automatic workspace allocator.
 * @returns Absolute workspace path; the native allocator handles name collisions.
 */
export async function createAutomaticWorkspace(): Promise<string> {
  const path = await desktopInvoke('create_automatic_workspace', { name: automaticWorkspaceName() })
  if (typeof path !== 'string' || !path.trim()) throw new Error('无法创建默认工作区，请稍后重试。')
  return path
}

/** Open a new composer with a draft, without attaching an existing Session.
 * @param prompt - Selected example text.
 * @param input - Normal conversation draft owner.
 * @param workspaces - Workspace creation API.
 * @param sessions - Session creation and selection API.
 * @param allocate - Desktop workspace allocator, deferred until sending.
 * @param selected - Optional workspace for connectors that explicitly reuse one.
 */
export function stageConnectorExample(
  prompt: string,
  input: Pick<IConversation['input'], 'setStagedDraft'>,
  workspaces: Pick<IWorkspaces, 'create'>,
  sessions: Pick<ISessions, 'create' | 'clear'>,
  allocate: (name: string) => Promise<string>,
  selected?: WorkspaceId,
): void {
  input.setStagedDraft(prompt, connectorSessionPreparation(workspaces, sessions, allocate, selected))
  sessions.clear()
}
