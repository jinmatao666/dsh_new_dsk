// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TurnCredits } from '../src/client/TurnCredits.tsx'
import { zh } from '../src/client/locales.ts'
import type { AuthView } from '../src/client/controller.ts'

afterEach(cleanup)

function fixture(enabled = true, custom = false, charged = true) {
  const auth: AuthView = { state: 'authenticated', username: 'Admin', models: [] }
  const requestTurnCredits = vi.fn(async () => ({ enabled: true, pending: false, credits: 7.25,
    items: charged ? [{ id: 'model-1', name: '模型调用 · qwen3.6-plus', credits: -5.25 },
      { id: 'skill-1', name: '技能调用 · 合同起草', credits: -2 }] : [] }))
  const props = { sessionId: 'session-a', turn: { turn: 1, end: { time: 100 },
    data: { get: () => ({ tokenUsage: { routes: [{ provider: custom ? 'custom-gateway' : 'dsh-server', model: 'qwen3.6-plus' }] } }) } },
  accounting: { getSnapshot: () => enabled, subscribe: () => () => {} }, requestTurnCredits,
  useAuth: <T,>(select: (value: AuthView) => T) => select(auth),
  t: (key: keyof typeof zh) => zh[key],
  } as unknown as Parameters<typeof TurnCredits>[0]
  return { props, requestTurnCredits }
}

it('shows exact settled total and opens a modal containing model and skill charges', async () => {
  const { props, requestTurnCredits } = fixture()
  render(<TurnCredits {...props} />)
  const trigger = await screen.findByRole('button', { name: /7.25 积分/ })
  expect(trigger.textContent).toMatchInlineSnapshot('"本轮消耗·7.25 积分›"')
  expect(requestTurnCredits).toHaveBeenCalledWith('session-a', 1)
  expect(screen.queryByText('技能调用 · 合同起草')).toBeNull()
  fireEvent.click(trigger)
  expect(screen.getByText('本轮积分明细')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull()
  expect(screen.getByText('技能调用 · 合同起草')).toBeTruthy()
  expect(screen.getByText('模型调用 · qwen3.6-plus')).toBeTruthy()
  const open = vi.fn()
  window.addEventListener('dsh:open-settings-section', open, { once: true })
  fireEvent.click(screen.getByRole('button', { name: '积分与用量' }))
  expect(open.mock.calls[0]?.[0].detail).toBe('wanwei-credits')
  expect(screen.queryByText('本轮积分明细')).toBeNull()
})

it('shows a static no-cost label for custom-model turns without platform charges', async () => {
  const { props } = fixture(true, true, false)
  render(<TurnCredits {...props} />)
  expect(await screen.findByText('本轮无积分消耗')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText('›')).toBeNull()
})

it('retains charge details when a custom-model turn has platform charges', async () => {
  const { props } = fixture(true, true)
  render(<TurnCredits {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /7.25 积分/ }))
  expect(screen.getByText('技能调用 · 合同起草')).toBeTruthy()
  expect(screen.queryByText('本轮无积分消耗')).toBeNull()
})

it('hides the entire feature and makes no requests while accounting is off', () => {
  const { props, requestTurnCredits } = fixture(false)
  const { container } = render(<TurnCredits {...props} />)
  expect(container.innerHTML).toBe('')
  expect(requestTurnCredits).not.toHaveBeenCalled()
})

it('removes the open details when accounting is turned off', async () => {
  const { props } = fixture()
  const { rerender } = render(<TurnCredits {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /7.25 积分/ }))
  rerender(<TurnCredits {...props} accounting={{ ...props.accounting, getSnapshot: () => false }} />)
  expect(screen.queryByText('本轮积分明细')).toBeNull()
  expect(screen.queryByText('本轮消耗')).toBeNull()
})
