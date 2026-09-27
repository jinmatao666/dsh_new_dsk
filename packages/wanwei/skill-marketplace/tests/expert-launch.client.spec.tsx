// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExpertMarket } from '../src/client/plugin.tsx'

vi.mock('../src/client/expert-webview.tsx', () => ({
  ExpertWebview: () => <div data-testid="native-expert">专家网站</div>,
}))

afterEach(cleanup)

const experts = [{ key: 'brand-new-expert', name: '动态专家', workbench_url: 'https://expert.example.com/' }]
const loadExperts = async () => experts
const launch = { url: 'https://expert.example.com/', ticket: 'a'.repeat(64) }

describe('published expert launch ownership', () => {
  it('opens an unknown published expert in the native Tab', async () => {
    const launchExpert = vi.fn(async () => launch)
    render(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert} />)
    fireEvent.click(await screen.findByRole('button', { name: '动态专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(await screen.findByTestId('native-expert')).toBeTruthy()
    expect(launchExpert).toHaveBeenCalledWith('brand-new-expert')
    fireEvent.click(screen.getByRole('button', { name: '关闭动态专家标签' }))
    expect(screen.queryByTestId('native-expert')).toBeNull()
  })

  it.each(['resolve', 'reject'] as const)('ignores a %s arriving after logout', async (settlement) => {
    let resolveLaunch: ((value: typeof launch) => void) | undefined
    let rejectLaunch: ((error: Error) => void) | undefined
    const launchExpert = vi.fn(() => new Promise<typeof launch>((resolve, reject) => {
      resolveLaunch = resolve
      rejectLaunch = reject
    }))
    render(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert} />)
    fireEvent.click(await screen.findByRole('button', { name: '动态专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('wanwei:auth-state', { detail: { authenticated: false } }))
      if (settlement === 'resolve') resolveLaunch?.(launch)
      else rejectLaunch?.(new Error('late launch failure'))
    })
    expect(screen.queryByTestId('native-expert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('late launch failure')).toBeNull()
    expect(launchExpert).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate a pending launch or transfer it into a replacement catalog', async () => {
    let resolveLaunch: ((value: typeof launch) => void) | undefined
    const launchExpert = vi.fn(() => new Promise<typeof launch>((resolve) => { resolveLaunch = resolve }))
    const view = render(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert} />)
    fireEvent.click(await screen.findByRole('button', { name: '动态专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    fireEvent.click(screen.getByRole('button', { name: '正在打开…' }))
    expect(launchExpert).toHaveBeenCalledTimes(1)
    view.unmount()
    render(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert} />)
    await screen.findByRole('button', { name: '动态专家' })
    await act(async () => { resolveLaunch?.(launch) })
    expect(screen.queryByTestId('native-expert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(launchExpert).toHaveBeenCalledTimes(1)
  })
})
