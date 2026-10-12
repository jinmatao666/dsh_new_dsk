/** Atomic, cross-process coordinated local task storage. */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { AutomationSnapshot } from './contract.ts'

/** Validate task fields at both durable and RPC inputs. */
export const taskInput = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(20000),
  cwd: z.string().trim().min(1),
  cadence: z.enum(['daily', 'workdays', 'friday']),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  enabled: z.boolean(),
}).strict()
const taskSchema = taskInput.extend({ id: z.string().min(1), owner: z.string().min(1), nextRunAt: z.number().int().nonnegative() })
const runSchema = z.object({
  id: z.string().min(1), owner: z.string().min(1), pid: z.number().int().positive(),
  taskId: z.string(), taskName: z.string(), startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  status: z.enum(['running', 'success', 'failed', 'interrupted']),
  trigger: z.enum(['scheduled', 'manual']), sessionId: z.string().optional(), error: z.string().optional(),
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
