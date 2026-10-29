// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FeishuPanel, FEISHU_EXAMPLE_PROMPTS, type FeishuStatus } from '../src/client/FeishuPanel.tsx'

afterEach(cleanup)
const base: FeishuStatus = {
  installed: true, authed: false, authorizing: false, authorizationUrl: null, qrDataUrl: null, error: null,
  missingScopes: [], authorizationStage: null, bridge: { enabled: false, state: 'stopped', error: null },
}

it('opens authorization from the main action and shows the QR only during authorization', async () => {
  const waiting = { ...base, authorizing: true, authorizationUrl: 'https://accounts.feishu.cn/authorize', qrDataUrl: 'data:image/png;base64,test' }
  const call = vi.fn(async (operation: string) => operation === 'login' ? waiting : base)
  render(<FeishuPanel api={{ call }} onStatus={vi.fn()} onTry={vi.fn()} />)
  const connect = await screen.findByRole('button', { name: '连接' })
  expect(screen.queryByAltText('飞书授权二维码')).toBeNull()
  expect(within(screen.getByRole('region', { name: '试试这样用' })).getAllByRole('button')).toHaveLength(4)
  fireEvent.click(connect)
  expect(await screen.findByAltText('飞书授权二维码')).toBeTruthy()
  expect(call).toHaveBeenCalledWith('login')
  expect(screen.getByRole('button', { name: '等待授权…' }).hasAttribute('disabled')).toBe(true)
})

it('stages a connected example and keeps unbind as a secondary action', async () => {
  const onTry = vi.fn()
  const call = vi.fn(async () => ({ ...base, authed: true }))
  render(<FeishuPanel api={{ call }} onStatus={vi.fn()} onTry={onTry} />)
  fireEvent.click(await screen.findByRole('button', { name: '去试试' }))
  expect(onTry).toHaveBeenCalledWith(FEISHU_EXAMPLE_PROMPTS[0])
  expect(screen.getByRole('button', { name: '解绑' }).classList.contains('secondary')).toBe(true)
  expect(screen.queryByRole('button', { name: '配置飞书应用' })).toBeNull()
})

it('shows targeted authorization instead of try actions when business permissions are missing', async () => {
  const onTry = vi.fn()
  const call = vi.fn(async () => ({ ...base, authed: true, missingScopes: ['im:message.send_as_user'] }))
  render(<FeishuPanel api={{ call }} onStatus={vi.fn()} onTry={onTry} />)
  const authorize = await screen.findByRole('button', { name: '补充授权' })
  expect(screen.queryByRole('button', { name: '去试试' })).toBeNull()
  expect(screen.getByText('以你的身份发送飞书消息').title).toBe('im:message.send_as_user')
  for (const button of within(screen.getByRole('region', { name: '试试这样用' })).getAllByRole('button')) expect(button).toHaveProperty('disabled', true)
  fireEvent.click(authorize)
  expect(call).toHaveBeenCalledWith('login')
  expect(onTry).not.toHaveBeenCalled()
})

it('offers explicit user-message permission and shows a waiting state while supplementing it', async () => {
  const call = vi.fn(async (operation: string) => ({ ...base, authed: true, authorizing: operation === 'authorize-messages', authorizationStage: operation === 'authorize-messages' ? 'login' as const : null }))
  render(<FeishuPanel api={{ call }} onStatus={vi.fn()} onTry={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '授权发送消息' }))
  expect(call).toHaveBeenCalledWith('authorize-messages')
  expect(await screen.findByRole('button', { name: '等待授权…' })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('button', { name: '去试试' })).toBeNull()
})

it('enables and disables the inbound channel with actual readiness separate from login', async () => {
  let bridge: FeishuStatus['bridge'] = { enabled: false, state: 'stopped', error: null }
  const call = vi.fn(async (operation: string) => {
    if (operation === 'bridge-enable') bridge = { enabled: true, state: 'ready', error: null }
    if (operation === 'bridge-disable') bridge = { enabled: false, state: 'stopped', error: null }
    return { ...base, authed: true, bridge }
  })
  render(<FeishuPanel api={{ call }} onStatus={vi.fn()} onTry={vi.fn()} />)
  expect(screen.queryByRole('region', { name: '飞书消息通道' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: '开启双向任务' }))
  expect(await screen.findByText('正在接收飞书指令')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '飞书消息通道' })).toBeNull()
  expect(call).toHaveBeenCalledWith('bridge-enable')
  fireEvent.click(screen.getByRole('button', { name: '关闭双向任务' }))
  expect(await screen.findByText('双向任务未开启')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '飞书消息通道' })).toBeNull()
  expect(call).toHaveBeenCalledWith('bridge-disable')
})
