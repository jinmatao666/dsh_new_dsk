// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FeishuPanel, FEISHU_EXAMPLE_PROMPTS, type FeishuStatus } from '../src/client/FeishuPanel.tsx'

afterEach(cleanup)
const base: FeishuStatus = { installed: true, authed: false, authorizing: false, authorizationUrl: null, qrDataUrl: null, error: null }

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
