import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AutomationStore, taskInput } from '../src/store.ts'
import { nextOccurrence } from '../src/schedule.ts'

it('persists task edits, isolates account reads and serializes competing writers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
  try {
    const file = join(dir, 'tasks.json')
    const store = new AutomationStore(file)
    expect(await store.snapshot('a')).toEqual({ tasks: [], runs: [] })
    await Promise.all(['a', 'b'].map(owner => store.update((state) => {
      state.tasks.push({ id: owner, owner, name: owner, prompt: 'run', cwd: dir,
        cadence: 'daily', time: '09:00', enabled: true, nextRunAt: 1 })
    })))
    expect((await new AutomationStore(file).snapshot('a')).tasks.map(task => task.id)).toEqual(['a'])
    await expect(store.update((state) => { state.tasks[0]!.time = '25:00' })).rejects.toThrow()
    expect((await store.read()).tasks).toHaveLength(2)
    await writeFile(file, 'invalid')
    await expect(store.read()).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('validates time and skips weekends without returning a past slot', () => {
  expect(taskInput.safeParse({ name: 't', prompt: 'p', cwd: '/tmp', cadence: 'daily', time: '24:00', enabled: true }).success).toBe(false)
  const friday = new Date(2026, 9, 9, 9, 0, 0).getTime()
  expect(new Date(nextOccurrence({ cadence: 'workdays', time: '09:00' }, friday)).getDay()).toBe(1)
  expect(nextOccurrence({ cadence: 'friday', time: '09:00' }, friday)).toBe(new Date(2026, 9, 16, 9).getTime())
})
