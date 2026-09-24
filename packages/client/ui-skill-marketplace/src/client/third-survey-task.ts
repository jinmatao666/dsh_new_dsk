import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

export type ThirdSurveyTask = {
  id: string
  sessionId: SessionId
  name: string
  directory: string
  createdAt: number
}

export type ThirdSurveyResult = {
  task: ThirdSurveyTask
  status: 'running' | 'completed' | 'failed'
  answer: string
  files: readonly string[]
  analysisViewPath?: string
  error?: string
}

export type ThirdSurveyTaskService = {
  list(): Promise<readonly ThirdSurveyTask[]>
  start(input: { name: string; files: readonly File[]; year: number; coordinateSystem: string }): Promise<ThirdSurveyTask>
  read(task: ThirdSurveyTask): Promise<ThirdSurveyResult>
  wait(task: ThirdSurveyTask, onUpdate: (result: ThirdSurveyResult) => void): Promise<ThirdSurveyResult>
  openFile(path: string): Promise<void>
  readAnalysisView(path: string): Promise<unknown>
}

type NativeWindow = Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown> }

const wait = (milliseconds: number) => new Promise((resolve) => { window.setTimeout(resolve, milliseconds) })
const skillSlug = 'market-gis-third-survey-analysis'

/** A dedicated archived Host session reuses the normal skill/model pipeline without a chat row. */
export function createThirdSurveyTaskService(connection: ConnectionHandle, workspaces: IWorkspaces): ThirdSurveyTaskService {
  const native = async (command: string, args: unknown): Promise<unknown> => {
    const invoke = (window as NativeWindow).__ZJUGIS_NATIVE_INVOKE__
    if (invoke === undefined) throw new Error('请在桌面端使用三调土地利用现状分析专家。')
    return invoke(command, args)
  }
  const remote = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const response = await connection.rpc.call('/desktop-auth', endpoint, payload)
    if (!response.ok) throw new Error(response.error.message)
    return response.value
  }
  const ensureSkill = async (): Promise<void> => {
    const installed = await native('list_marketplace_skills', {})
    if (Array.isArray(installed) && installed.some(item => typeof item === 'object' && item !== null && (item as { slug?: unknown }).slug === skillSlug)) return
    const catalog = await remote('skill-list', {}) as { items?: unknown }
    const skill = Array.isArray(catalog.items) ? catalog.items.find(item => typeof item === 'object' && item !== null && (item as { name?: unknown }).name === skillSlug) as { id?: unknown } | undefined : undefined
    if (typeof skill?.id !== 'number') throw new Error('专家所需的三调土地利用现状分析技能未上架，无法开始分析。')
    const bundle = await remote('skill-bundle', { id: skill.id }) as { assets?: unknown; sha256?: unknown }
    if (typeof bundle.assets !== 'string' || typeof bundle.sha256 !== 'string') throw new Error('三调土地利用现状分析技能包不完整。')
    const parsed: unknown = JSON.parse(bundle.assets)
    const entries = typeof parsed === 'object' && parsed !== null ? (parsed as { files?: unknown }).files : undefined
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('三调土地利用现状分析技能包没有文件。')
    const files = entries.map((entry) => {
      const file = entry as { path?: unknown; contentBase64?: unknown }
      if (typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') throw new Error('三调土地利用现状分析技能文件格式无效。')
      return { path: file.path, content: Array.from(atob(file.contentBase64), char => char.charCodeAt(0)) }
    })
    await native('install_marketplace_skill', { slug: skillSlug, files, sha256: bundle.sha256 })
  }
  const storageKey = async (): Promise<string> => {
    const response = await connection.rpc.call('/desktop-auth', 'status', {})
    if (!response.ok) throw new Error(response.error.message)
    const value = response.value as { state?: unknown; username?: unknown }
    if (value.state !== 'authenticated' || typeof value.username !== 'string' || value.username === '') {
      throw new Error('请先登录后使用专家工作台。')
    }
    return `dsh.expert.third-survey.tasks.${value.username}`
  }
  const list = async (): Promise<readonly ThirdSurveyTask[]> => {
    const raw = localStorage.getItem(await storageKey())
    if (raw === null) return []
    try {
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? value.filter((task): task is ThirdSurveyTask => typeof task === 'object' && task !== null && typeof task.id === 'string' && typeof task.sessionId === 'string' && typeof task.directory === 'string') : []
    } catch { return [] }
  }
  const save = async (task: ThirdSurveyTask): Promise<void> => {
    const key = await storageKey()
    const existing = await list()
    localStorage.setItem(key, JSON.stringify([task, ...existing.filter(item => item.id !== task.id)]))
  }
  const read = async (task: ThirdSurveyTask): Promise<ThirdSurveyResult> => {
    const response = await connection.api.sessions.history({ sessionId: task.sessionId, maxMessages: 100 })
    if (!response.result.ok) throw new Error(response.result.error.message)
    const events = response.result.value.events.map(item => item.event)
    const completed = events.findLast(event => event.type === 'turn/end')
    const finalMessage = events.findLast(event => event.type === 'assistant/message')
    const answer = finalMessage?.type === 'assistant/message'
      ? finalMessage.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      : ''
    const output = await native('list_expert_output_files', { directory: task.directory })
    const files = Array.isArray(output) ? output.filter((file): file is string => typeof file === 'string') : []
    const missing = completed?.data.reason.kind === 'completed' && (!files.some(file => /\.docx$/i.test(file)) || !files.some(file => /\.xlsx$/i.test(file)))
    const status = completed === undefined ? 'running' : completed.data.reason.kind === 'completed' && !missing ? 'completed' : 'failed'
    const analysisViewPath = files.filter(file => /(?:-analysis-view_|分析视图_|审查视图_)\d{8}_\d{6}_\d{3}\.json$/u.test(file.split(/[\\/]/).at(-1) ?? '')).at(-1)
    return { task, status, answer, files, ...(analysisViewPath ? { analysisViewPath } : {}), ...(status === 'failed' ? { error: missing ? '本次三调分析未完整生成 Word 报告和 Excel 明细。' : '分析未正常完成，请查看上方模型回答。' } : {}) }
  }
  return {
    list,
    async start(input) {
      await ensureSkill()
      const recent = workspaces.list.getSnapshot().recentWorkspaceId
      const parent = workspaces.list.getSnapshot().items.find(item => item.workspaceId === recent)?.path ?? await workspaces.pickDirectory()
      if (parent === null) throw new Error('请选择用于保存分析成果的文件夹。')
      const id = crypto.randomUUID()
      const directory = await workspaces.createDirectory(parent, `三调现状分析-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${id.slice(0, 6)}`)
      const payload = await Promise.all(input.files.map(async file => ({
        name: file.name,
        bytes: [...new Uint8Array(await file.arrayBuffer())],
      })))
      const imported = await native('import_workspace_files', { workspacePath: directory, files: payload })
      if (!Array.isArray(imported) || !imported.every(name => typeof name === 'string')) throw new Error('导入的地块文件信息无效。')
      const session = await connection.api.sessions.create({ cwd: directory })
      if (!session.result.ok) throw new Error(session.result.error.message)
      const sessionId = session.result.value.sessionId
      const archived = await connection.api.workspace.archiveSession({ sessionId })
      if (!archived.result.ok) throw new Error(`无法隐藏专家内部会话：${archived.result.error.message}`)
      const task: ThirdSurveyTask = { id, sessionId, name: input.name, directory, createdAt: Date.now() }
      const selected = imported.find(name => /\.(?:geojson|json|zip|shp)$/i.test(name))
      const inputPath = imported.length === 1 && selected ? `${directory}\\${selected}` : directory
      const prompt = `使用 /${skillSlug} 开展项目“${input.name}”的三调土地利用现状分析。输入范围：${inputPath}。输出目录：${directory}。三调年度：${input.year || 2024}。${input.coordinateSystem.trim() ? `用户确认的坐标系：${input.coordinateSystem.trim()}。` : ''}按该技能和三调年度完成真实接口分析，返回三调现状、地类构成、耕地、永久基本农田、权属与数据限制，生成 Excel 明细和 Word 报告。不得把现状统计解释为规划违法或规划不符合。不要复用已有分析结果；只报告本次实际生成的文件。若必须确认输入文件或坐标系，请说明原因并停止，不要猜测。`
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
        await wait(2500)
      }
    },
    openFile: path => workspaces.openPath(path),
    readAnalysisView: path => native('read_analysis_view', { path }),
  }
}
