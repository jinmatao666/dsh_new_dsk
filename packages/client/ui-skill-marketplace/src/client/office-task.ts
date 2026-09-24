import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'

export type OfficeTaskStatus = 'running' | 'completed' | 'partial' | 'failed'
export type OfficeTask = {
  id: string
  sessionId: SessionId
  name: string
  directory: string
  createdAt: number
  kind: string
  skill: string
  inputs: readonly { name: string; size: number }[]
  expected: readonly string[]
  expectedOutputCount?: number
  parameters?: Readonly<Record<string, string>>
  prompt: string
}
export type OfficeResult = {
  task: OfficeTask
  status: OfficeTaskStatus
  answer: string
  files: readonly string[]
  textArtifacts: Readonly<Record<string, string>>
  error?: string
}
type OfficeTaskInput = {
  name: string
  kind: string
  skill: string
  files: readonly File[]
  expected: readonly string[]
  expectedOutputCount?: number
  parameters?: Readonly<Record<string, string>>
  instruction: string
}
export type OfficeTaskService = {
  list(): Promise<readonly OfficeTask[]>
  chooseDirectory(name: string): Promise<string | null>
  start(input: OfficeTaskInput): Promise<OfficeTask>
  read(task: OfficeTask): Promise<OfficeResult>
  wait(task: OfficeTask, onUpdate: (result: OfficeResult) => void): Promise<OfficeResult>
  openFile(path: string): Promise<void>
}
type NativeWindow = Window & {
  __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown>
}

const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

export function createOfficeTaskService(
  connection: ConnectionHandle,
  workspaces: IWorkspaces,
  expertKey: string,
  directoryPrefix: string,
): OfficeTaskService {
  const native = async (command: string, args: unknown) => {
    const invoke = (window as NativeWindow).__ZJUGIS_NATIVE_INVOKE__
    if (!invoke) throw new Error('请在桌面端使用该专家。')
    return invoke(command, args)
  }
  const remote = async (endpoint: string, payload: unknown) => {
    const result = await connection.rpc.call('/desktop-auth', endpoint, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const storageKey = async () => {
    const result = await connection.rpc.call('/desktop-auth', 'status', {})
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as { state?: unknown; username?: unknown }
    if (value.state !== 'authenticated' || typeof value.username !== 'string') throw new Error('请先登录。')
    return `dsh.expert.${expertKey}.tasks.${value.username}`
  }
  const list = async () => {
    try {
      const raw = localStorage.getItem(await storageKey())
      const value: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(value) ? value as OfficeTask[] : []
    } catch {
      return []
    }
  }
  const save = async (task: OfficeTask) => {
    const key = await storageKey()
    const old = await list()
    localStorage.setItem(key, JSON.stringify([task, ...old.filter(item => item.id !== task.id)]))
  }
  const ensureSkill = async (slug: string) => {
    const installed = await native('list_marketplace_skills', {})
    if (Array.isArray(installed) && installed.some(item =>
      typeof item === 'object' && item !== null && (item as { slug?: unknown }).slug === slug)) return
    const catalog = await remote('skill-list', {}) as { items?: unknown }
    const item = Array.isArray(catalog.items)
      ? catalog.items.find(candidate => typeof candidate === 'object'
        && candidate !== null && (candidate as { name?: unknown }).name === slug) as { id?: unknown } | undefined
      : undefined
    if (typeof item?.id !== 'number') throw new Error(`技能 ${slug} 尚未上架。`)
    const bundle = await remote('skill-bundle', { id: item.id }) as { assets?: unknown; sha256?: unknown }
    if (typeof bundle.assets !== 'string' || typeof bundle.sha256 !== 'string') throw new Error('技能包不完整。')
    const entries = (JSON.parse(bundle.assets) as { files?: unknown }).files
    if (!Array.isArray(entries)) throw new Error('技能包没有文件。')
    const files = entries.map((entry) => {
      const file = entry as { path?: unknown; contentBase64?: unknown }
      if (typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') throw new Error('技能文件无效。')
      return { path: file.path, content: Array.from(atob(file.contentBase64), character => character.charCodeAt(0)) }
    })
    await native('install_marketplace_skill', { slug, files, sha256: bundle.sha256 })
  }
  const read = async (task: OfficeTask): Promise<OfficeResult> => {
    const history = await connection.api.sessions.history({ sessionId: task.sessionId, maxMessages: 100 })
    if (!history.result.ok) throw new Error(history.result.error.message)
    const events = history.result.value.events.map(item => item.event)
    const end = events.findLast(event => event.type === 'turn/end')
    const message = events.findLast(event => event.type === 'assistant/message')
    const answer = message?.type === 'assistant/message'
      ? message.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      : ''
    const output = await native('list_expert_output_files', { directory: task.directory })
    const inputs = new Set(task.inputs.map(item => item.name.toLocaleLowerCase()))
    const files = Array.isArray(output)
      ? output.filter((item): item is string => typeof item === 'string'
        && !inputs.has(item.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? ''))
      : []
    const matches = task.expected.map(pattern => files.some(file => new RegExp(pattern, 'i').test(file)))
    const requiredOk = matches.filter(Boolean).length
    const artifacts = files.filter(file => task.expected.some(pattern => new RegExp(pattern, 'i').test(file)))
    const readable = artifacts.filter(path => /\.(md|json|txt|diff)$/i.test(path))
    const entries = await Promise.all(readable.map(async (path) => {
      try {
        const content = await native('read_expert_text_file', { directory: task.directory, path })
        return typeof content === 'string' ? [path, content] as const : null
      } catch {
        return null
      }
    }))
    const textArtifacts = Object.fromEntries(
      entries.filter((entry): entry is readonly [string, string] => entry !== null),
    )
    const producedOk = task.expectedOutputCount === undefined
      ? requiredOk
      : Math.min(artifacts.length, task.expectedOutputCount)
    const requiredTotal = task.expectedOutputCount ?? matches.length
    const normal = end?.data.reason.kind === 'completed'
    const status: OfficeTaskStatus = end === undefined
      ? 'running'
      : normal && requiredOk === matches.length && producedOk >= requiredTotal
        ? 'completed'
        : normal && (requiredOk > 0 || producedOk > 0) ? 'partial' : 'failed'
    return {
      task,
      status,
      answer,
      files: artifacts,
      textArtifacts,
      ...(status === 'failed'
        ? { error: normal ? '任务结束，但未找到必需成果文件。' : '处理未正常完成，请查看执行摘要。' }
        : {}),
    }
  }
  return {
    list,
    async chooseDirectory(name) {
      const snapshot = workspaces.list.getSnapshot()
      const parent = snapshot.items.find(item => item.workspaceId === snapshot.recentWorkspaceId)?.path
        ?? await workspaces.pickDirectory()
      if (parent === null) return null
      const safeName = name.trim().replace(/[<>:"/\\|?*]/g, '-').slice(0, 36) || '未命名任务'
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      return workspaces.createDirectory(parent, `${directoryPrefix}-${safeName}-${timestamp}`)
    },
    async start(input) {
      await ensureSkill(input.skill)
      const payload = await Promise.all(input.files.map(async file => ({
        name: file.name,
        bytes: [...new Uint8Array(await file.arrayBuffer())],
      })))
      const directory = await this.chooseDirectory(input.name)
      if (directory === null) throw new Error('未选择任务目录。')
      const imported = await native('import_workspace_files', { workspacePath: directory, files: payload })
      if (!Array.isArray(imported) || !imported.every(name => typeof name === 'string')) throw new Error('导入文件失败。')
      const session = await connection.api.sessions.create({ cwd: directory })
      if (!session.result.ok) throw new Error(session.result.error.message)
      const sessionId = session.result.value.sessionId
      const archived = await connection.api.workspace.archiveSession({ sessionId })
      if (!archived.result.ok) throw new Error('无法归档内部会话。')
      const paths = imported.map((name: string) => `${directory}\\${name}`)
      const prompt = `使用 /${input.skill} 完成本次任务。输入文件：${paths.join('；')}。输出目录：${directory}。`
        + `${input.instruction} 必须调用技能正式脚本，只能根据实际产物报告成功、部分成功或失败，不得伪造文件、进度或结果。`
      const task: OfficeTask = {
        id: crypto.randomUUID(),
        sessionId,
        name: input.name,
        kind: input.kind,
        skill: input.skill,
        directory,
        createdAt: Date.now(),
        inputs: input.files.map(file => ({ name: file.name, size: file.size })),
        expected: input.expected,
        ...(input.expectedOutputCount === undefined ? {} : { expectedOutputCount: input.expectedOutputCount }),
        ...(input.parameters === undefined ? {} : { parameters: input.parameters }),
        prompt,
      }
      const started = await connection.api.sessions.prompt({
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (!started.result.ok) throw new Error(started.result.error.message)
      await save(task)
      return task
    },
    read,
    async wait(task, onUpdate) {
      while (true) {
        const result = await read(task)
        onUpdate(result)
        if (result.status !== 'running') return result
        await pause(2500)
      }
    },
    openFile: path => workspaces.openPath(path),
  }
}
