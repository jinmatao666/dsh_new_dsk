// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExpertMarket } from '../src/client/plugin.tsx'

vi.mock('../src/client/expert-webview.tsx', () => ({
  ExpertWebview: ({ launch, visible }: { launch: { id: string }; visible: boolean }) => <div data-testid="native-expert" data-expert={launch.id} hidden={!visible}>专家网站</div>,
}))

afterEach(cleanup)

const experts = [{ key: 'brand-new-expert', name: '动态专家', workbench_url: 'https://expert.example.com/' }]
const loadExperts = async () => experts
const launch = { url: 'https://expert.example.com/', ticket: 'a'.repeat(64) }

describe('published expert launch ownership', () => {
  it('keeps multiple experts in the catalog tab row and reuses their mounted workbenches', async () => {
    const launchExpert = vi.fn(async () => launch)
    const view = render(<div className="dsh-skill-market-panel"><ExpertMarket
      loadExperts={async () => [...experts, { key: 'second-expert', name: '第二专家', workbench_url: launch.url }]}
      launchExpert={launchExpert} /></div>)
    fireEvent.click(await screen.findByRole('button', { name: '动态专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    const firstView = await screen.findByTestId('native-expert')
    expect(view.container.firstElementChild?.classList.contains('dsh-expert-view-open')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '专家' }))
    expect(firstView.hidden).toBe(true)
    expect(view.container.firstElementChild?.classList.contains('dsh-expert-view-open')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '第二专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    await screen.findByRole('button', { name: '关闭第二专家标签' })
    expect(screen.getAllByTestId('native-expert')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '动态专家' }))
    expect(firstView.hidden).toBe(false)
    expect(screen.getAllByTestId('native-expert')[0]).toBe(firstView)
    // Opening an already-open expert from the catalog focuses it without a new ticket.
    fireEvent.click(screen.getByRole('button', { name: '专家' }))
    fireEvent.click(screen.getAllByRole('button', { name: '动态专家' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(launchExpert).toHaveBeenCalledTimes(2)
    expect(firstView.hidden).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '关闭第二专家标签' }))
    expect(firstView.hidden).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '关闭动态专家标签' }))
    expect(screen.queryByTestId('native-expert')).toBeNull()
    expect(screen.getByRole('button', { name: '专家' }).getAttribute('aria-current')).toBe('page')
  })
  it('shows only published experts without an expert-team entry', async () => {
    render(<ExpertMarket loadExperts={loadExperts} />)
    expect(await screen.findByRole('button', { name: '动态专家' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '专家团' })).toBeNull()
    expect(screen.queryByText('国土空间规划审查专家团')).toBeNull()
    expect(screen.getByRole('button', { name: '全部' })).toBeTruthy()
  })

  it('opens an unknown published expert in the native Tab', async () => {
    const launchExpert = vi.fn(async () => launch)
    const prepareExpertWorkspace = vi.fn(async () => {})
    render(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert} prepareExpertWorkspace={prepareExpertWorkspace} />)
    fireEvent.click(await screen.findByRole('button', { name: '动态专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(await screen.findByTestId('native-expert')).toBeTruthy()
    expect(launchExpert).toHaveBeenCalledWith('brand-new-expert')
    expect(prepareExpertWorkspace).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '动态专家' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭动态专家标签' }))
    expect(screen.queryByTestId('native-expert')).toBeNull()
    expect(screen.getByRole('button', { name: '动态专家' })).toBeTruthy()
  })

  it('keeps a launched expert usable if window maximization fails', async () => {
    const prepareExpertWorkspace = vi.fn(async () => { throw new Error('window unavailable') })
    render(<ExpertMarket loadExperts={loadExperts} launchExpert={async () => launch} prepareExpertWorkspace={prepareExpertWorkspace} />)
    fireEvent.click(await screen.findByRole('button', { name: '动态专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(await screen.findByTestId('native-expert')).toBeTruthy()
    expect(prepareExpertWorkspace).toHaveBeenCalledTimes(1)
  })

  it('does not change the window layout when the expert launch fails', async () => {
    const prepareExpertWorkspace = vi.fn(async () => {})
    render(<ExpertMarket loadExperts={loadExperts} launchExpert={async () => { throw new Error('launch failed') }} prepareExpertWorkspace={prepareExpertWorkspace} />)
    fireEvent.click(await screen.findByRole('button', { name: '动态专家' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect((await screen.findByRole('alert')).textContent).toContain('launch failed')
    expect(prepareExpertWorkspace).not.toHaveBeenCalled()
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
