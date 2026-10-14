import { describe, expect, it } from 'vitest'
import { advanceSchedule, nextOccurrence } from '../src/schedule.ts'
import { taskInput } from '../src/store.ts'
import type { AutomationTask } from '../src/contract.ts'

const at = (date: string) => new Date(`${date}T09:00:00`).getTime()

describe('local task schedules', () => {
  it('runs a one-shot exactly once and expires inclusive ranges', () => {
    const task = { cadence: 'once', time: '09:00', startDate: '2026-10-20' } as const
    expect(nextOccurrence(task, at('2026-10-19'))).toBe(at('2026-10-20'))
    expect(nextOccurrence(task, at('2026-10-20'))).toBe(0)
    const range = { cadence: 'daily', time: '09:00', startDate: '2026-10-20', endDate: '2026-10-21' } as const
    expect(nextOccurrence(range, at('2026-10-20'))).toBe(at('2026-10-21'))
    expect(nextOccurrence(range, at('2026-10-21'))).toBe(0)
  })
  it('keeps interval and fortnight schedules anchored when cursors skip missed runs', () => {
    const interval = { cadence: 'interval', time: '09:00', startDate: '2026-10-20', intervalMinutes: 90 } as const
    expect(nextOccurrence(interval, at('2026-10-20') + 95 * 60000)).toBe(at('2026-10-20') + 180 * 60000)
    expect(nextOccurrence({ ...interval, endDate: '2026-10-20' }, at('2026-10-21'))).toBe(0)
    expect(nextOccurrence({ cadence: 'biweekly', time: '09:00', startDate: '2026-10-14' }, at('2026-10-15'))).toBe(at('2026-10-28'))
    expect(nextOccurrence({ cadence: 'weekly', time: '09:00', startDate: '2026-10-14' }, at('2026-10-15'))).toBe(at('2026-10-21'))
  })
  it('clamps missing month days while retaining the original calendar anchor', () => {
    const monthly = { cadence: 'monthly', time: '09:00', startDate: '2026-01-31' } as const
    expect(nextOccurrence(monthly, at('2026-01-31'))).toBe(at('2026-02-28'))
    expect(nextOccurrence(monthly, at('2026-02-28'))).toBe(at('2026-03-31'))
    expect(nextOccurrence({ ...monthly, startDate: '2027-01-31' }, at('2026-12-01'))).toBe(at('2027-01-31'))
    expect(nextOccurrence({ cadence: 'yearly', time: '09:00', startDate: '2024-02-29' }, at('2024-02-29'))).toBe(at('2025-02-28'))
  })
  it('pauses an exhausted schedule and rejects malformed calendar configuration', () => {
    const task: AutomationTask = { id: 'once', name: 'once', prompt: 'run', cwd: '/tmp', enabled: true,
      nextRunAt: at('2026-10-20'), cadence: 'once', startDate: '2026-10-20', time: '09:00' }
    advanceSchedule(task, at('2026-10-20'))
    expect(task).toMatchObject({ enabled: false, nextRunAt: 0 })
    const base = { name: 't', prompt: 'p', cwd: '/tmp', time: '09:00', enabled: true }
    for (const extra of [
      { cadence: 'once' }, { cadence: 'daily', startDate: '2026-02-30' },
      { cadence: 'interval', startDate: '2026-10-20', intervalMinutes: 0 },
      { cadence: 'daily', startDate: '2026-10-20', endDate: '2026-10-19' },
    ]) expect(taskInput.safeParse({ ...base, ...extra }).success).toBe(false)
    expect(taskInput.parse({ ...base, cadence: 'weekly', startDate: '2026-10-20', fullAccess: false,
      model: { provider: 'p', model: 'm' } })).toMatchObject({ fullAccess: false, model: { provider: 'p', model: 'm' } })
  })
})
