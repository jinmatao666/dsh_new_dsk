/** Browser-safe local task and execution records. */
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

/** Persisted schedule, execution choices and enabled state for one local task. */
export interface AutomationTask {
  id: string
  name: string
  prompt: string
  cwd: string
  cadence: 'daily' | 'workdays' | 'friday' | 'interval' | 'once' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'
  time: string
  /** Local calendar anchor for weekly, monthly and yearly schedules. */
  startDate?: string | undefined
  /** Inclusive last local date; absent means no expiry. */
  endDate?: string | undefined
  intervalMinutes?: number | undefined
  /** Absent follows the configured model at execution time. */
  model?: ModelSelection | undefined
  /** Absent defaults to full access. */
  fullAccess?: boolean | undefined
  /** Legacy tool selection retained for reading saved tasks; does not enable result delivery. */
  connectors?: ('feishu' | 'dingtalk' | 'wechat')[] | undefined
  /** Automatic delivery channels; absent means all switches are off. */
  pushChannels?: ('feishu' | 'dingtalk' | 'wechat')[] | undefined
  enabled: boolean
  /** Zero means no eligible future occurrence. */
  nextRunAt: number
}
/** Execution interval for a fresh, task-owned Session. */
export interface AutomationRun {
  id: string
  taskId: string
  taskName: string
  startedAt: number
  endedAt?: number | undefined
  status: 'running' | 'success' | 'failed' | 'interrupted' | 'waiting' | 'incomplete'
  trigger: 'scheduled' | 'manual'
  sessionId?: string | undefined
  error?: string | undefined
  /** Delivery is independent of task execution status. */
  deliveries?: { channel: 'feishu' | 'dingtalk' | 'wechat'; status: 'pending' | 'sent' | 'failed'; error?: string | undefined }[] | undefined
  deliveryText?: string | undefined
  /** Latest committed progress; retained for continuation in the original Session. */
  checkpoint?: AutomationCheckpoint | undefined
}
/** Model-reported progress; completed file paths are independently checked by the Host. */
export interface AutomationCheckpoint {
  stage: 'preflight' | 'progress' | 'completed' | 'waiting' | 'incomplete'
  summary: string
  nextSteps: string[]
  files: string[]
  producesFiles: boolean
  updatedAt: number
}
/** Account-filtered committed state; no sample tasks are supplied. */
export interface AutomationSnapshot {
  tasks: AutomationTask[]
  runs: AutomationRun[]
}
