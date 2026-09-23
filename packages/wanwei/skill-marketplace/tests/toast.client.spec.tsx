// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast, type WanweiNotice } from '../src/client/Toast.tsx'

function Harness() {
  const [notice, setNotice] = useState<WanweiNotice | null>(null)
  return (
    <>
      <button type="button" onClick={() => { setNotice({ kind: 'success', text: '技能已安装' }) }}>成功</button>
      <button type="button" onClick={() => { setNotice({ kind: 'error', text: '安装失败' }) }}>失败</button>
      <Toast notice={notice} setNotice={setNotice} />
    </>
  )
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Wanwei transient feedback', () => {
  it('keeps success visible briefly and dismisses it without moving page content', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '成功' }))
    expect(screen.getByRole('status').textContent).toContain('技能已安装')
    act(() => { vi.advanceTimersByTime(4_499) })
    expect(screen.getByRole('status')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('gives errors longer, restarts the timer on a new message, and supports manual dismissal', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '成功' }))
    act(() => { vi.advanceTimersByTime(4_000) })
    fireEvent.click(screen.getByRole('button', { name: '失败' }))
    act(() => { vi.advanceTimersByTime(4_500) })
    expect(screen.getByRole('alert').textContent).toContain('安装失败')
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
