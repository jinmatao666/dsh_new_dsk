// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CheckinShortcut, CreditsSection } from '../src/client/CreditsSection.tsx'
afterEach(cleanup)
const auth = { state: 'authenticated', username: 'alice', models: [] } as const
const useAuth = (select: (value: typeof auth) => unknown) => select(auth)
const kit = {
  useAuth: useAuth as never, useSessions: vi.fn() as never,
  useSessionPendingInteraction: vi.fn() as never, useWorkspaces: vi.fn() as never }
const eligible = { enabled: true, can_claim: true, amount: 100, interval_days: 1, next_date: '' }
describe('desktop credit entry and check-in', () => {
  it('hides disabled shortcuts and opens the dedicated page when eligible', async () => {
    const request = vi.fn(async () => ({ enabled: false }))
    const view = render(<CheckinShortcut {...kit} wide requestCredits={request} />)
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(screen.queryByRole('button')).toBeNull()
    view.unmount()
    const open = vi.fn(); window.addEventListener('dsh:open-settings-section', open, { once: true })
    render(<CheckinShortcut {...kit} wide requestCredits={async () => eligible} />)
    fireEvent.click(await screen.findByRole('button', { name: '签到领积分' }))
    expect(open.mock.calls[0]?.[0].detail).toBe('wanwei-credits')
  })
  it('claims explicitly, refreshes balance, and hides the sidebar entry', async () => {
    let claimed = false
    const request = vi.fn(async (op: string) => {
      if (op === 'claim') claimed = true
      return op === 'history' ? { balance: claimed ? 1100 : 1000, total: 0, items: [] }
        : { ...eligible, can_claim: !claimed, next_date: claimed ? '2026-11-05' : '' }
    })
    render(<>
      <CheckinShortcut {...kit} wide requestCredits={request} />
      <CreditsSection {...kit} close={vi.fn()} requestCredits={request} /></>)
    await screen.findByRole('button', { name: '签到领积分' })
    fireEvent.click(await screen.findByRole('button', { name: '立即签到' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '签到领积分' })).toBeNull())
    expect(await screen.findByRole('button', { name: '本周期已签到' })).toHaveProperty('disabled', true)
    expect(await screen.findByText('1,100')).toBeTruthy()
    expect(request.mock.calls.filter(([op]) => op === 'claim')).toHaveLength(1)
  })
  it('shows service errors in a dialog rather than appending a form', async () => {
    render(<CreditsSection {...kit} close={vi.fn()} requestCredits={async () => { throw new Error('连接失败') }} />)
    expect(await screen.findByRole('dialog', { name: '积分服务提示' })).toBeTruthy()
    expect(screen.getByText('连接失败')).toBeTruthy()
  })
})

it('provides first/last/jump navigation and removes historical balance fields', async () => {
  const request = vi.fn(async (op: string, page = 0) => op === 'history'
    ? { balance: 1000, total: 126, items: [{ id: String(page), time: 1793754026, name: '调用记录', credits: -1, balance: null }] }
    : { enabled: false })
  render(<CreditsSection {...kit} close={vi.fn()} requestCredits={request} />)
  await screen.findByText('调用记录')
  expect(screen.getByText('变动后余额')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '末页' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('history', 6, 'all'))
  await screen.findByText('调用记录')
  expect(screen.getByRole('button', { name: '下一页' })).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByRole('spinbutton', { name: '跳转页码' }), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: '跳转' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('history', 2, 'all'))
  await screen.findByText('调用记录')
  fireEvent.click(screen.getByRole('button', { name: '首页' }))
  await screen.findByText('调用记录')
  expect(screen.getByRole('button', { name: '上一页' })).toHaveProperty('disabled', true)
})
