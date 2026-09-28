// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Select } from '../src/Select.tsx'

afterEach(cleanup)

const options = [
  { value: 'all', label: '全部技能' },
  { value: 'platform', label: '平台技能' },
  { value: 'hub', label: 'SkillHub 技能' },
]

describe('Select', () => {
  it('opens a listbox and passes the chosen value to its owner', () => {
    const onChange = vi.fn()
    render(<Select label="技能来源" value="all" options={options} onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: '技能来源' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('listbox', { name: '技能来源' })).toBeTruthy()
    const option = screen.getByRole('option', { name: '平台技能' })
    expect(fireEvent.pointerDown(option)).toBe(false)
    fireEvent.click(option)
    expect(onChange).toHaveBeenCalledWith('platform')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('supports arrow keys, selection and Escape', () => {
    const onChange = vi.fn()
    render(<Select label="技能来源" value="all" options={options} onChange={onChange} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('platform')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('supports reverse movement, Home/End, Space and focus dismissal', () => {
    const onChange = vi.fn()
    render(<Select label="技能来源" value="platform" options={options} onChange={onChange} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    fireEvent.keyDown(trigger, { key: 'Home' })
    fireEvent.keyDown(trigger, { key: 'End' })
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(onChange).toHaveBeenCalledWith('hub')
    fireEvent.click(trigger)
    fireEvent.pointerEnter(screen.getByRole('option', { name: '全部技能' }))
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('all')
    fireEvent.click(trigger)
    fireEvent.blur(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens above its trigger when there is not enough room below', () => {
    const oldHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 180 })
    try {
      render(<Select label="技能来源" value="all" options={options} onChange={vi.fn()} />)
      const trigger = screen.getByRole('combobox')
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        top: 670, bottom: 700, left: 20, width: 140,
      } as DOMRect)
      fireEvent.click(trigger)
      expect(screen.getByRole('listbox').getAttribute('style')).toContain('top: 486px')
      fireEvent.resize(window)
      fireEvent.scroll(window)
    } finally {
      if (oldHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', oldHeight)
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
    }
  })

  it('closes on outside pointer input and respects disabled state', () => {
    const onChange = vi.fn()
    render(<><Select label="技能来源" value="all" options={options} onChange={onChange} />
      <Select label="不可选" value="all" options={options} onChange={onChange} disabled />
      <button type="button">外部</button></>)
    expect(screen.getByRole('combobox', { name: '不可选' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('combobox', { name: '技能来源' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the owner-provided empty label when no choices exist', () => {
    render(<Select label="技能分类" emptyLabel="暂无可用分类" value="" options={[]} onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox', { name: '技能分类' })
    expect(trigger.textContent).toContain('暂无可用分类')
    expect(trigger.hasAttribute('disabled')).toBe(true)
  })

  it('falls back to its label when the current choice is unavailable', () => {
    const view = render(<Select label="选择技能" value="missing" options={options} onChange={vi.fn()} />)
    expect(screen.getByRole('combobox').textContent).toContain('选择技能')
    view.rerender(<Select label="选择技能" value="" options={[]} onChange={vi.fn()} />)
    expect(screen.getByRole('combobox').textContent).toContain('选择技能')
  })
})
