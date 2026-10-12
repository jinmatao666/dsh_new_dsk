/** Browser-safe local task and execution records. */
export interface AutomationTask {
  id: string
  name: string
  prompt: string
  cwd: string
  cadence: 'daily' | 'workdays' | 'friday'
  time: string
  enabled: boolean
  nextRunAt: number
}
/** Execution interval for a fresh, task-owned Session. */
export interface AutomationRun {
  id: string
  taskId: string
  taskName: string
  startedAt: number
  endedAt?: number | undefined
  status: 'running' | 'success' | 'failed' | 'interrupted'
  trigger: 'scheduled' | 'manual'
  sessionId?: string | undefined
  error?: string | undefined
}
/** Account-filtered committed state; no sample tasks are supplied. */
export interface AutomationSnapshot {
  tasks: AutomationTask[]
  runs: AutomationRun[]
}
