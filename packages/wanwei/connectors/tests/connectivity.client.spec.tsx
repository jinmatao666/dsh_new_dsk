// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { DingTalkApi } from '../src/client/DingTalkPanel.tsx'
import type { WeChatApi } from '../src/client/WeChatPanel.tsx'
import { Connectors } from '../src/client/plugin.tsx'

const dingTalk: DingTalkApi = {
  status: async () => ({ dwsInstalled: false, dwsVersion: null, authed: false, skillInstalled: false, hint: null }),
  login: async () => ({ dwsInstalled: false, dwsVersion: null, authed: false, skillInstalled: false, hint: null }),
  installSkill: async () => ({ dwsInstalled: false, dwsVersion: null, authed: false, skillInstalled: false, hint: null }),
  disconnect: async () => ({ dwsInstalled: false, dwsVersion: null, authed: false, skillInstalled: false, hint: null }),
}
const weChatStatus = { authed: false, bridgeRunning: false, hint: null, sessionId: null }
const weChat: WeChatApi = {
  status: async () => weChatStatus,
  loginStart: async () => ({ sessionKey: '', qrcodeUrl: '', qrDataUrl: '', status: weChatStatus }),
  loginPoll: async () => ({
    phase: 'wait', status: weChatStatus, message: null, qrcodeUrl: null, qrDataUrl: null,
  }),
  disconnect: async () => weChatStatus,
  ensureSession: async () => ({ sessionId: 'wechat-session-1' }),
}

afterEach(cleanup)
it('recovers the directory after a dropped local check and keeps the illustration only while the service stays down', async () => {
  const checkConnection = vi.fn(async () => {})
  checkConnection.mockRejectedValueOnce(new Error('Failed to fetch'))
  const props = { dingTalk, weChat, onTryPrompt: () => {}, checkConnection }
  const recovered = render(<Connectors {...props} />)
  expect(await screen.findByText('钉钉')).toBeTruthy()
  expect(screen.queryByText('企业微信')).toBeNull()
  expect(screen.queryByRole('heading', { name: '暂时无法连接连接器服务' })).toBeNull()
  expect(checkConnection.mock.calls.length).toBeGreaterThan(1)
  recovered.unmount()

  checkConnection.mockReset()
  checkConnection.mockRejectedValue(new Error('平台服务连接失败'))
  const view = render(<Connectors {...props} />)
  expect(await screen.findByRole('heading', { name: '暂时无法连接连接器服务' })).toBeTruthy()
  expect(screen.queryByText('钉钉')).toBeNull()
  expect(screen.getByRole('alert').textContent).toMatchInlineSnapshot('"暂时无法连接连接器服务当前网络无法连接该服务，请检查网络连接或联系管理员。"')
  expect(screen.getByRole('alert').classList.contains('wanwei-service-unavailable-connectors')).toBe(true)
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull()
  view.unmount()
  checkConnection.mockReset()
  checkConnection.mockResolvedValue(undefined)
  render(<Connectors {...props} />)
  expect(await screen.findByText('钉钉')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
