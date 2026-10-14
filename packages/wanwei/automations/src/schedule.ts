/** Local calendar recurrence; missed slots are never replayed. */
import type { AutomationTask } from './contract.ts'

type Schedule = Pick<AutomationTask, 'cadence' | 'time' | 'startDate' | 'endDate' | 'intervalMinutes'>

/** Find the next local occurrence strictly after a cursor.
 * @param task - Validated recurrence, inclusive validity and local HH:mm time.
 * @param after - Exclusive epoch-millisecond cursor.
 * @returns Next occurrence, or zero when the schedule is exhausted.
 */
export function nextOccurrence(task: Schedule, after: number): number {
  const [hour, minute] = task.time.split(':').map(Number)
  const cursor = new Date(after)
  const anchor = task.startDate === undefined
    ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hour, minute)
    : new Date(`${task.startDate}T${task.time}:00`)
  const end = task.endDate === undefined ? Number.POSITIVE_INFINITY : new Date(`${task.endDate}T23:59:59.999`).getTime()
  const accept = (value: number): number => value > after && value <= end ? value : 0
  if (task.cadence === 'once') return accept(anchor.getTime())
  if (task.cadence === 'interval') {
    const minutes = task.intervalMinutes
    if (minutes === undefined) throw new Error('间隔任务缺少执行间隔')
    const step = minutes * 60000
    return accept(anchor.getTime() + Math.max(0, Math.floor((after - anchor.getTime()) / step) + 1) * step)
  }
  if (task.cadence === 'monthly' || task.cadence === 'yearly') {
    const firstYear = Math.max(cursor.getFullYear(), anchor.getFullYear())
    const firstMonth = task.cadence === 'monthly'
      ? Math.max(cursor.getFullYear() * 12 + cursor.getMonth(), anchor.getFullYear() * 12 + anchor.getMonth())
      : firstYear * 12 + anchor.getMonth()
    for (let offset = 0; offset < 3; offset++) {
      const month = firstMonth + offset * (task.cadence === 'yearly' ? 12 : 1)
      const day = Math.min(anchor.getDate(), new Date(Math.floor(month / 12), month % 12 + 1, 0).getDate())
      const value = new Date(Math.floor(month / 12), month % 12, day, hour, minute).getTime()
      if (value >= anchor.getTime() && value > after) return accept(value)
    }
    return 0
  }
  const first = new Date(Math.max(after, anchor.getTime()))
  for (let offset = 0; offset <= 14; offset++) {
    const candidate = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset, hour, minute)
    const day = candidate.getDay()
    // Calendar ordinals preserve fortnight parity across DST changes.
    const days = (Date.UTC(candidate.getFullYear(), candidate.getMonth(), candidate.getDate())
      - Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())) / 86400000
    const eligible = task.cadence === 'daily'
      || (task.cadence === 'workdays' && day >= 1 && day <= 5)
      || (task.cadence === 'friday' && day === 5)
      || (task.cadence === 'weekly' && day === anchor.getDay())
      || (task.cadence === 'biweekly' && days % 14 === 0)
    if (eligible && candidate.getTime() >= anchor.getTime() && candidate.getTime() > after) return accept(candidate.getTime())
  }
  return 0
}

/** Advance a saved task and pause exhausted schedules.
 * @param task - Mutable saved task.
 * @param after - Exclusive scheduling cursor.
 */
export function advanceSchedule(task: AutomationTask, after: number): void {
  task.nextRunAt = nextOccurrence(task, after)
  if (task.nextRunAt === 0) task.enabled = false
}
