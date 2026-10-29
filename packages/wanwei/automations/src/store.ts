/** Atomic, cross-process coordinated local task storage. */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { AutomationSnapshot } from './contract.ts'

/** Local date validation rejects calendar rollovers such as February 30. */
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10))
}, '请选择有效日期')
/** Validate task fields at both durable and RPC inputs. */
export const taskInput = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(20000),
  cwd: z.string().trim().min(1),
  cadence: z.enum(['daily', 'workdays', 'friday', 'interval', 'once', 'weekly', 'biweekly', 'monthly', 'yearly']),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  startDate: localDate.optional(), endDate: localDate.optional(),
  intervalMinutes: z.number().int().min(1).max(525600).optional(),
  model: z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional() }).strict()
    .transform(({ reasoningEffort, ...route }) => ({ ...route, ...reasoningEffort === undefined ? {} : { reasoningEffort } })).optional(),
  fullAccess: z.boolean().optional(),
  connectors: z.array(z.enum(['feishu', 'dingtalk', 'wechat'])).max(3)
    .refine(value => new Set(value).size === value.length, '连接器不能重复').optional(),
  pushChannels: z.array(z.enum(['feishu', 'dingtalk', 'wechat'])).max(3).refine(v => new Set(v).size === v.length).optional(),
  enabled: z.boolean(),
}).strict().superRefine((task, ctx) => {
  if (task.startDate !== undefined && task.endDate !== undefined && task.endDate < task.startDate) {
    ctx.addIssue({ code: 'custom', message: '结束日期不能早于开始日期', path: ['endDate'] })
  }
  if (!['daily', 'workdays', 'friday'].includes(task.cadence) && task.startDate === undefined) {
    ctx.addIssue({ code: 'custom', message: '请选择开始日期', path: ['startDate'] })
  }
  if (task.cadence === 'interval' && task.intervalMinutes === undefined) {
    ctx.addIssue({ code: 'custom', message: '请设置执行间隔', path: ['intervalMinutes'] })
  }
})
const taskSchema = taskInput.safeExtend({ id: z.string().min(1), owner: z.string().min(1), nextRunAt: z.number().int().nonnegative() })
const runSchema = z.object({
  id: z.string().min(1), owner: z.string().min(1), pid: z.number().int().positive(),
  taskId: z.string(), taskName: z.string(), startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  status: z.enum(['running', 'success', 'failed', 'interrupted', 'waiting', 'incomplete']),
  trigger: z.enum(['scheduled', 'manual']), sessionId: z.string().optional(), error: z.string().optional(),
  deliveryText: z.string().optional(),
  deliveries: z.array(z.object({ channel: z.enum(['feishu', 'dingtalk', 'wechat']), status: z.enum(['pending', 'sent', 'failed']), error: z.string().optional() }).strict()).max(3).optional(),
  checkpoint: z.object({
    stage: z.enum(['preflight', 'progress', 'completed', 'waiting', 'incomplete']),
    summary: z.string().min(1).max(8000), nextSteps: z.array(z.string().max(2000)).max(50),
    files: z.array(z.string()).max(128), producesFiles: z.boolean(), updatedAt: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict()
const documentSchema = z.object({ version: z.literal(1), tasks: z.array(taskSchema), runs: z.array(runSchema) }).strict()
/** Versioned local document with explicit account and process ownership. */
export type AutomationDocument = z.infer<typeof documentSchema>

/** One local document; read-modify-write never publishes before atomic replacement. */
export class AutomationStore {
  constructor(readonly filename: string) {}

  /** Read a validated document, treating only ENOENT as an empty first install.
   * @returns Durable tasks and records.
   */
  async read(): Promise<AutomationDocument> {
    let raw: string
    try { raw = await readFile(this.filename, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tasks: [], runs: [] }
      throw error
    }
    return documentSchema.parse(JSON.parse(raw))
  }

  /** Commit one serialized mutation, preserving writes made by other processes.
   * @param mutate - Synchronous mutation of the freshly loaded document.
   * @returns Mutation result after storage commits.
   */
  async update<T>(mutate: (state: AutomationDocument) => T): Promise<T> {
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    return withFileLock(this.filename, async () => {
      const state = await this.read()
      const result = mutate(state)
      await writeFileAtomic(this.filename, JSON.stringify(documentSchema.parse(state)), { mode: 0o600, dirMode: 0o700 })
      return result
    })
  }

  /** Return committed records for one authenticated local account.
   * @param owner - Host-resolved account name.
   * @returns Detached public state without process or account metadata.
   */
  async snapshot(owner: string): Promise<AutomationSnapshot> {
    const state = await this.read()
    return {
      tasks: state.tasks.filter(task => task.owner === owner).map(({ owner: _owner, ...task }) => task),
      runs: state.runs.filter(run => run.owner === owner).map(({ owner: _owner, pid: _pid, ...run }) => run).reverse(),
    }
  }
}
