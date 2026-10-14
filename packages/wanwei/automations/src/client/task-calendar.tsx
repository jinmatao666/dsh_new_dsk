/** Local date-range and two-column time controls for scheduled tasks. */
import { useEffect, useRef, useState } from 'react'
import { IconChevronLeftOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationTask } from '../contract.ts'
import { localDateKey } from './task-labels.ts'
import { productText as text } from './locales/product.ts'

/** Pick an exact local HH:mm time without platform-native popup differences.
 * @param props - Current time and draft-only update callback.
 * @returns Independently scrolling hour/minute columns.
 */
export function TaskTimePicker({ value, change }: { value: string; change: (value: string) => void }) {
  const [hour, minute] = value.split(':')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    for (const item of root.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]') ?? []) {
      const column = item.parentElement
      if (column) column.scrollTop = item.offsetTop - column.offsetTop - column.clientHeight / 2 + item.clientHeight / 2
    }
  }, [])
  return <div className="automation-time-columns" ref={root}>{[24, 60].map((count, column) =>
    <div key={count} role="group" aria-label={column === 0 ? text('小时') : text('分钟')}>
      {Array.from({ length: count }, (_, index) => String(index).padStart(2, '0')).map(item =>
        <button type="button" key={item} aria-pressed={item === (column === 0 ? hour : minute)}
          onClick={() => { change(column === 0 ? `${item}:${minute}` : `${hour}:${item}`) }}>{item}</button>)}
    </div>)}</div>
}

/** Pick start and inclusive end dates in a two-month calendar.
 * @param props - Task draft and explicit completion callback.
 * @returns Calendar panel; no host task changes until the form is saved.
 */
export function TaskCalendar({ draft, change, close }: {
  draft: AutomationTask
  change: (draft: AutomationTask) => void
  close: () => void
}) {
  const today = localDateKey(new Date())
  const start = draft.startDate ?? today
  const [field, setField] = useState<'start' | 'end'>('start')
  const [month, setMonth] = useState(() => { const date = new Date(`${start}T12:00:00`); return new Date(date.getFullYear(), date.getMonth(), 1) })
  const select = (value: string) => {
    if (field === 'start') {
      const { endDate, ...rest } = draft
      change({ ...rest, startDate: value, ...(endDate !== undefined && endDate >= value ? { endDate } : {}) })
      if (draft.cadence !== 'once') setField('end')
    } else change({ ...draft, startDate: start, endDate: value })
  }
  return <div className="automation-calendar">
    <div className="automation-date-fields">
      <button type="button" aria-pressed={field === 'start'} onClick={() => { setField('start') }}>{text('开始日期')}<strong>{start}</strong></button>
      {draft.cadence !== 'once' && <button type="button" aria-pressed={field === 'end'} onClick={() => { setField('end') }}>{text('结束日期')}<strong>{draft.endDate ?? text('长期有效')}</strong></button>}
    </div>
    <div className="automation-calendar-months">{[0, 1].map((offset) => {
      const date = new Date(month.getFullYear(), month.getMonth() + offset, 1)
      const first = (date.getDay() + 6) % 7
      return <section key={offset}>
        <header><button type="button" aria-label={text('上个月')} onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)) }}><IconChevronLeftOutline14 /></button>
          <span>{text('{0}年 {1}月', [date.getFullYear(), date.getMonth() + 1])}</span>
          <button type="button" aria-label={text('下个月')} onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)) }}><IconChevronRightOutline14 /></button></header>
        <div className="automation-calendar-grid">{text('一 二 三 四 五 六 日').split(' ').map(day => <small key={day}>{day}</small>)}
          {Array.from({ length: 42 }, (_, index) => {
            const day = new Date(date.getFullYear(), date.getMonth(), index - first + 1)
            const key = localDateKey(day)
            const outside = day.getMonth() !== date.getMonth()
            const selected = key === start || key === draft.endDate
            return <button type="button" key={index} aria-label={key} aria-pressed={selected}
              disabled={outside || key < today || (field === 'end' && key < start)}
              className={draft.endDate && key > start && key < draft.endDate ? 'in-range' : ''}
              onClick={() => { select(key) }}>{day.getDate()}</button>
          })}
        </div>
      </section>
    })}</div>
    <div className="automation-calendar-footer"><button type="button" onClick={() => { const { endDate: _end, ...rest } = draft; change(rest); setField('start') }}>{text('长期有效')}</button>
      <button type="button" onClick={close}>{text('确定')}</button></div>
  </div>
}
