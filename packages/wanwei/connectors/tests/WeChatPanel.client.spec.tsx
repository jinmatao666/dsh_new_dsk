// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  WeChatPanel, type WeChatApi, type WeChatLoginPoll, type WeChatLoginStart, type WeChatStatus,
} from '../src/client/WeChatPanel.tsx'
import { clearCachedWeChatStatus } from '../src/client/wechat-status-cache.ts'

afterEach(() => {
  cleanup()
  clearCachedWeChatStatus()
})

function api(overrides: Partial<WeChatApi> = {}): WeChatApi {
  const status: WeChatStatus = {
    authed: false,
    bridgeRunning: false,
    hint: '点击「连接」，用微信扫码绑定远程通道。',
    sessionId: null,
  }
  const start: WeChatLoginStart = {
    sessionKey: 'sess-1',
    qrcodeUrl: 'https://example.test/qr',
    qrDataUrl: 'data:image/png;base64,qq',
    status,
  }
  const waiting: WeChatLoginPoll = {
    phase: 'wait',
    status,
    message: null,
    qrcodeUrl: start.qrcodeUrl,
    qrDataUrl: start.qrDataUrl,
  }
  const confirmed: WeChatLoginPoll = {
    phase: 'confirmed',
    status: { authed: true, bridgeRunning: true, hint: null, sessionId: 'wechat-session-1' },
    message: '微信助理已连接',
    qrcodeUrl: null,
    qrDataUrl: null,
  }
  let polls = 0
  return {
    status: vi.fn(async () => status),
    loginStart: vi.fn(async () => start),
    loginPoll: vi.fn(async () => {
      polls += 1
      return polls === 1 ? waiting : confirmed
    }),
    disconnect: vi.fn(async () => status),
    ensureSession: vi.fn(async () => ({ sessionId: 'wechat-session-1' })),
    ...overrides,
  }
}

describe('WeChatPanel', () => {
  it('opens in-app QR, confirms, then cancels connection', async () => {
    const face = api()
    const onNotice = vi.fn()
    const onConnected = vi.fn()
    render(<WeChatPanel api={face} onNotice={onNotice} onConnected={onConnected} />)
    await waitFor(() => expect(face.status).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '连接' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '连接' }))
    })
    await waitFor(() => expect(face.loginStart).toHaveBeenCalled())
    await waitFor(() => expect(face.loginPoll).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: '取消连接' })).toBeTruthy())
    expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '微信助理已连接' })
    expect(onConnected).toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消连接' }))
    })
    await waitFor(() => expect(face.disconnect).toHaveBeenCalled())
    expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '微信助理已取消连接' })
  })

  it('shows 取消连接 immediately from initialStatus while soft-refreshing', async () => {
    let resolveStatus: (value: WeChatStatus) => void = () => {}
    const pending = new Promise<WeChatStatus>(resolve => { resolveStatus = resolve })
    const face = api({
      status: vi.fn(() => pending),
    })
    const initial: WeChatStatus = {
      authed: true,
      bridgeRunning: true,
      hint: null,
      sessionId: 'wechat-session-1',
    }
    render(<WeChatPanel api={face} initialStatus={initial} />)
    expect(screen.getByRole('button', { name: '取消连接' })).toBeTruthy()
    await act(async () => {
      resolveStatus(initial)
      await pending
    })
    await waitFor(() => expect(face.status).toHaveBeenCalled())
  })

  it('closes the QR sheet from status() when loginPoll never returns confirmed', async () => {
    vi.useFakeTimers()
    try {
      const onNotice = vi.fn()
      let statusCalls = 0
      const face = api({
        status: vi.fn(async () => {
          statusCalls += 1
          // First call is the mount soft-refresh; later calls are the QR-side probe.
          if (statusCalls <= 1) {
            return { authed: false, bridgeRunning: false, hint: null, sessionId: null }
          }
          return { authed: true, bridgeRunning: true, hint: null, sessionId: 'wechat-session-1' }
        }),
        loginPoll: vi.fn(() => new Promise<WeChatLoginPoll>(() => {})),
      })
      render(<WeChatPanel api={face} onNotice={onNotice} />)
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '连接' }))
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByRole('heading', { name: '微信助理' })).toBeTruthy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_600)
      })
      expect(screen.getByRole('button', { name: '取消连接' })).toBeTruthy()
      expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '微信助理已连接' })
    } finally {
      vi.useRealTimers()
    }
  })
})
