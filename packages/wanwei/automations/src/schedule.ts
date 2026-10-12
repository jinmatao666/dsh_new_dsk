/** Local wall-clock recurrence; missed slots are never replayed. */
import type { AutomationTask } from './contract.ts'

/** Find the first eligible local date strictly after a cursor.
 * @param task - Recurrence and HH:mm time.
 * @param after - Exclusive epoch-millisecond cursor.
 * @returns Next local occurrence as epoch milliseconds.
 */
export function nextOccurrence(task: Pick<AutomationTask, 'cadence' | 'time'>, after: number): number {
  const [hour, minute] = task.time.split(':').map(Number)
  const date = new Date(after)
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, hour, minute)
    const day = candidate.getDay()
    const eligible = task.cadence === 'daily'
      || (task.cadence === 'workdays' && day >= 1 && day <= 5)
      || (task.cadence === 'friday' && day === 5)
    if (eligible && candidate.getTime() > after) return candidate.getTime()
  }
  throw new Error('无法计算下一次执行时间')
}
