// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WeComPanel, type WeComApi, type WeComStatus } from '../src/client/WeComPanel.tsx'
import { clearCachedWeComStatus } from '../src/client/wecom-status-cache.ts'

afterEach(() => {
  cleanup()
  clearCachedWeComStatus()
})

function api(overrides: Partial<WeComApi> = {}): WeComApi {
  const status: WeComStatus = {
    cliInstalled: true,
    cliVersion: '1.0.0',
    authed: false,
    skillInstalled: false,
    hint: 'wecom-cli 已安装但未授权。',
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

describe('WeComPanel', () => {
  it('connects via QR login then tries an example prompt', async () => {
    const face = api()
    const onTry = vi.fn()
    const onNotice = vi.fn()
    render(<WeComPanel api={face} onTry={onTry} onNotice={onNotice} />)
    await waitFor(() => expect(face.status).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '连接' })).toBeTruthy()
    expect(screen.getByText('试试这样用')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '连接' }))
    })
    await waitFor(() => expect(face.login).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: '去试试' })).toBeTruthy())
    expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '企业微信已连接' })

    fireEvent.click(screen.getByRole('button', { name: '去试试' }))
    expect(onTry).toHaveBeenCalled()
    expect(String(onTry.mock.calls[0]?.[0] ?? '')).toMatch(/企业微信邮件和会议/)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '解绑' }))
    })
    await waitFor(() => expect(face.disconnect).toHaveBeenCalled())
    expect(onNotice).toHaveBeenCalledWith({ kind: 'success', text: '企业微信已解绑' })
  })

  it('shows 去试试 immediately from initialStatus while soft-refreshing', async () => {
    let resolveStatus: (value: WeComStatus) => void = () => {}
    const pending = new Promise<WeComStatus>(resolve => { resolveStatus = resolve })
    const face = api({
      status: vi.fn(() => pending),
    })
    const initial: WeComStatus = {
      cliInstalled: true,
      cliVersion: '1.0.0',
      authed: true,
      skillInstalled: true,
      hint: null,
    }
    render(<WeComPanel api={face} initialStatus={initial} />)
    expect(screen.getByRole('button', { name: '去试试' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '解绑' })).toBeTruthy()
    await act(async () => {
      resolveStatus(initial)
      await pending
    })
    await waitFor(() => expect(face.status).toHaveBeenCalled())
  })
})
