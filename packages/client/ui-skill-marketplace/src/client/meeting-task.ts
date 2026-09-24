import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createExpertTaskDirectory } from './expert-task-directory.ts'

export type MeetingInputFile = { name: string; size: number; kind: 'audio' | 'material' }
export type MeetingTask = {
  id: string
  sessionId: SessionId
  name: string
  directory: string
  createdAt: number
  inputs: readonly MeetingInputFile[]
}
export type MeetingResult = {
  task: MeetingTask
  status: 'running' | 'completed' | 'failed'
  answer: string
  wordPath?: string
  error?: string
}
export type MeetingTaskService = {
  list(): Promise<readonly MeetingTask[]>
  chooseDirectory(name: string): Promise<string | null>
  start(input: { name: string; files: readonly File[]; directory: string }): Promise<MeetingTask>
  read(task: MeetingTask): Promise<MeetingResult>
  wait(task: MeetingTask, onUpdate: (result: MeetingResult) => void): Promise<MeetingResult>
  openFile(path: string): Promise<void>
}

type NativeWindow = Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown> }
const skillSlug = 'office-meeting-minutes'
const pause = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

/** Run the meeting skill in an archived Host session and expose only its Word deliverable. */
export function createMeetingTaskService(connection: ConnectionHandle, workspaces: IWorkspaces): MeetingTaskService {
  const native = async (command: string, args: unknown): Promise<unknown> => {
    const invoke = (window as NativeWindow).__ZJUGIS_NATIVE_INVOKE__
    if (invoke === undefined) throw new Error('请在桌面端使用会议纪要专家。')
    return invoke(command, args)
  }
  const remote = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const response = await connection.rpc.call('/desktop-auth', endpoint, payload)
    if (!response.ok) throw new Error(response.error.message)
    return response.value
  }
  const storageKey = async (): Promise<string> => {
    const response = await connection.rpc.call('/desktop-auth', 'status', {})
    if (!response.ok) throw new Error(response.error.message)
    const value = response.value as { state?: unknown; username?: unknown }
    if (value.state !== 'authenticated' || typeof value.username !== 'string' || value.username === '') throw new Error('请先登录后使用会议纪要专家。')
    return `dsh.expert.meeting-minutes.tasks.${value.username}`
  }
  const list = async (): Promise<readonly MeetingTask[]> => {
    const raw = localStorage.getItem(await storageKey())
    if (raw === null) return []
    try {
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? value.filter((task): task is MeetingTask => typeof task === 'object' && task !== null && typeof task.id === 'string' && typeof task.sessionId === 'string' && typeof task.directory === 'string' && Array.isArray((task as MeetingTask).inputs)) : []
    } catch { return [] }
  }
  const save = async (task: MeetingTask): Promise<void> => {
    const key = await storageKey()
    const current = await list()
    localStorage.setItem(key, JSON.stringify([task, ...current.filter(item => item.id !== task.id)]))
  }
  const ensureSkill = async (): Promise<void> => {
    const installed = await native('list_marketplace_skills', {})
    if (Array.isArray(installed) && installed.some(item => typeof item === 'object' && item !== null && (item as { slug?: unknown }).slug === skillSlug)) return
    const catalog = await remote('skill-list', {}) as { items?: unknown }
    const skill = Array.isArray(catalog.items) ? catalog.items.find(item => typeof item === 'object' && item !== null && (item as { name?: unknown }).name === skillSlug) as { id?: unknown } | undefined : undefined
    if (typeof skill?.id !== 'number') throw new Error('会议纪要技能尚未上架，无法开始生成。')
    const bundle = await remote('skill-bundle', { id: skill.id }) as { assets?: unknown; sha256?: unknown }
    if (typeof bundle.assets !== 'string' || typeof bundle.sha256 !== 'string') throw new Error('会议纪要技能包不完整。')
    const parsed: unknown = JSON.parse(bundle.assets)
    const entries = typeof parsed === 'object' && parsed !== null ? (parsed as { files?: unknown }).files : undefined
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('会议纪要技能包没有文件。')
    const files = entries.map((entry) => {
      const file = entry as { path?: unknown; contentBase64?: unknown }
      if (typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') throw new Error('会议纪要技能文件格式无效。')
      return { path: file.path, content: Array.from(atob(file.contentBase64), char => char.charCodeAt(0)) }
    })
    await native('install_marketplace_skill', { slug: skillSlug, files, sha256: bundle.sha256 })
  }
  const read = async (task: MeetingTask): Promise<MeetingResult> => {
    const history = await connection.api.sessions.history({ sessionId: task.sessionId, maxMessages: 100 })
    if (!history.result.ok) throw new Error(history.result.error.message)
    const events = history.result.value.events.map(item => item.event)
    const completed = events.findLast(event => event.type === 'turn/end')
    const finalMessage = events.findLast(event => event.type === 'assistant/message')
    const answer = finalMessage?.type === 'assistant/message' ? finalMessage.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : ''
    const output = await native('list_expert_output_files', { directory: task.directory })
    const wordPath = Array.isArray(output) ? output.filter((path): path is string => typeof path === 'string' && /\.docx$/i.test(path)).at(-1) : undefined
    const normalEnd = completed?.data.reason.kind === 'completed'
    const status = completed === undefined ? 'running' : normalEnd && wordPath !== undefined ? 'completed' : 'failed'
    return {
      task, status, answer,
      ...(wordPath === undefined ? {} : { wordPath }),
      ...(status === 'failed' ? { error: normalEnd ? '任务已结束，但本次目录中没有找到会议纪要 Word 文件。' : '纪要生成未正常完成，请查看执行摘要并调整材料。' } : {}),
    }
  }
  return {
    list,
    async chooseDirectory(name) {
      const recent = workspaces.list.getSnapshot().recentWorkspaceId
      const parent = workspaces.list.getSnapshot().items.find(item => item.workspaceId === recent)?.path ?? await workspaces.pickDirectory()
      if (parent === null) return null
      const safeName = name.trim().replace(/[<>:"/\\|?*]/g, '-').slice(0, 36) || '未命名会议'
      return createExpertTaskDirectory(native, parent, `会议纪要-${safeName}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${crypto.randomUUID().slice(0, 6)}`)
    },
    async start(input) {
      await ensureSkill()
      const payload = await Promise.all(input.files.map(async file => ({
        name: file.name,
        bytes: [...new Uint8Array(await file.arrayBuffer())],
      })))
      const imported = await native('import_workspace_files', { workspacePath: input.directory, files: payload })
      if (!Array.isArray(imported) || !imported.every(name => typeof name === 'string')) throw new Error('导入的会议材料信息无效。')
      const session = await connection.api.sessions.create({ cwd: input.directory })
      if (!session.result.ok) throw new Error(session.result.error.message)
      const sessionId = session.result.value.sessionId
      const archived = await connection.api.workspace.archiveSession({ sessionId })
      if (!archived.result.ok) throw new Error(`无法隐藏专家内部会话：${archived.result.error.message}`)
      const id = crypto.randomUUID()
      const inputs: MeetingInputFile[] = input.files.map(file => ({ name: file.name, size: file.size, kind: /\.(?:wav|m4a|mp3)$/i.test(file.name) ? 'audio' : 'material' }))
      const task: MeetingTask = { id, sessionId, name: input.name.trim() || '未命名会议', directory: input.directory, createdAt: Date.now(), inputs }
      const paths = imported.map(name => `${input.directory}\\${name}`)
      const audio = paths.find(path => /\.(?:wav|m4a|mp3)$/i.test(path))
      const materials = paths.filter(path => !/\.(?:wav|m4a|mp3)$/i.test(path))
      const prompt = `使用 /${skillSlug} 为本次任务生成会议纪要。会议名称：${input.name.trim() || '未明确'}。${audio ? `录音文件：${audio}。` : '本次没有录音。'}${materials.length > 0 ? `补充材料：${materials.join('；')}。` : '本次没有补充材料。'}输出目录：${input.directory}。必须基于本次真实材料执行；信息未明确时写“未明确”，不要补造说话人、责任人、日期或结论。只向用户交付本次实际生成的一个 Word 会议纪要，不要把转写 TXT、Markdown、JSON 或处理报告作为产物。依赖或转写失败时请说明原始原因和可执行的处理建议。`
      const started = await connection.api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
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
