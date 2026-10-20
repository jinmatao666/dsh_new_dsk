// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DingTalkPanel, type DingTalkApi, type DingTalkStatus } from '../src/client/DingTalkPanel.tsx'
import { clearCachedDingTalkStatus } from '../src/client/status-cache.ts'

afterEach(() => {
  cleanup()
  clearCachedDingTalkStatus()
})

function api(overrides: Partial<DingTalkApi> = {}): DingTalkApi {
  const status: DingTalkStatus = {
    dwsInstalled: true,
    dwsVersion: '1.0.0',
    authed: false,
    skillInstalled: false,
    hint: 'dws 已安装但未登录。',
  }
  return {
    status: vi.fn(async () => status),
    login: vi.fn(async () => ({
      ...status,
      authed: true,
      skillInstalled: true,
      hint: null,
    })),
    installSkill: vi.fn(async () => ({
      ...status,
      authed: true,
      skillInstalled: true,
      hint: null,
    })),
    disconnect: vi.fn(async () => status),
    ...overrides,
  }
}

describe('DingTalkPanel', () => {
  it('connects via browser login then tries an example prompt', async () => {
    const face = api()
    const onTry = vi.fn()
    const onNotice = vi.fn()
    render(<DingTalkPanel api={face} onTry={onTry} onNotice={onNotice} />)
    await waitFor(() => expect(face.status).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '连接' })).toBeTruthy()
    expect(screen.getByText('试试这样用')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '连接' }))
    })
    await waitFor(() => expect(face.login).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: '去试试' })).toBeTruthy())
    expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '钉钉已连接' })

    fireEvent.click(screen.getByRole('button', { name: '去试试' }))
    expect(onTry).toHaveBeenCalled()
    expect(String(onTry.mock.calls[0]?.[0] ?? '')).toMatch(/钉钉日程/)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '解绑' }))
    })
    await waitFor(() => expect(face.disconnect).toHaveBeenCalled())
    expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '钉钉已解绑' })
  })

  it('shows 去试试 immediately from initialStatus while soft-refreshing', async () => {
    let resolveStatus: (value: DingTalkStatus) => void = () => {}
    const pending = new Promise<DingTalkStatus>(resolve => { resolveStatus = resolve })
    const face = api({
      status: vi.fn(() => pending),
    })
    const initial: DingTalkStatus = {
      dwsInstalled: true,
      dwsVersion: '1.0.0',
      authed: true,
      skillInstalled: true,
      hint: null,
    }
    render(<DingTalkPanel api={face} initialStatus={initial} />)
    expect(screen.getByRole('button', { name: '去试试' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '解绑' })).toBeTruthy()
    await act(async () => {
      resolveStatus(initial)
      await pending
    })
    await waitFor(() => expect(face.status).toHaveBeenCalled())
  })

  it('polls status while Host login stays authorizing after the RPC returns', async () => {
    vi.useFakeTimers()
    try {
      const face = api({
        login: vi.fn(async () => ({
          dwsInstalled: true,
          dwsVersion: '1.0.0',
          authed: false,
          skillInstalled: false,
          hint: null,
          authorizing: true,
          authorizeError: null,
        })),
        status: vi.fn()
          .mockResolvedValueOnce({
            dwsInstalled: true,
            dwsVersion: '1.0.0',
            authed: false,
            skillInstalled: false,
            hint: null,
            authorizing: false,
            authorizeError: null,
          })
          .mockResolvedValueOnce({
            dwsInstalled: true,
            dwsVersion: '1.0.0',
            authed: false,
            skillInstalled: false,
            hint: null,
            authorizing: true,
            authorizeError: null,
          })
          .mockResolvedValue({
            dwsInstalled: true,
            dwsVersion: '1.0.0',
            authed: true,
            skillInstalled: true,
            hint: null,
            authorizing: false,
            authorizeError: null,
          }),
      })
      const onNotice = vi.fn()
      render(<DingTalkPanel api={face} onNotice={onNotice} />)
      await act(async () => {
        await Promise.resolve()
      })
      expect(face.status).toHaveBeenCalled()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '连接' }))
      })
      expect(face.login).toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(screen.getByRole('button', { name: '去试试' })).toBeTruthy()
      expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '钉钉已连接' })
      expect(face.status.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces load errors and keeps a single 连接 button when skill is still missing', async () => {
    const face = api({
      status: vi.fn(async () => { throw new Error('boom') }),
    })
    render(<DingTalkPanel api={face} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('boom'))

    cleanup()
    const face2 = api({
      status: vi.fn(async () => ({
        dwsInstalled: true,
        dwsVersion: '1.0.0',
        authed: true,
        skillInstalled: false,
        hint: '已授权，但尚未写入 dws-cli 技能。',
      })),
    })
    render(<DingTalkPanel api={face2} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '连接' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '连接' }))
    })
    await waitFor(() => expect(face2.login).toHaveBeenCalled())
  })
})
