// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExpertMarket } from '../src/client/ExpertMarket.tsx'
import type { NetworkState } from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'

afterEach(cleanup)
it.each(['hide', 'disable'] as const)('uses %s for internet experts and restores them after a successful probe', async (internetCatalogPolicy) => {
  const loadExperts = async () => [
    { key: 'online-expert', name: '联网专家', requires_internet: true, workbench_url: 'https://example.com/' },
    { key: 'offline-expert', name: '内网专家', requires_internet: false, workbench_url: 'http://expert.lan/' },
  ]
  const launchExpert = vi.fn(async () => ({ url: 'https://example.com/', ticket: 'ticket' }))
  const state: NetworkState = { mode: 'intranet', internalOrigins: [], directInternet: false, internetCatalogPolicy }
  const subscribe = () => () => {}
  const view = render(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert}
    network={{ subscribe, getSnapshot: () => state }} />)
  expect(await screen.findByRole('button', { name: '内网专家' })).toBeTruthy()
  if (internetCatalogPolicy === 'hide') expect(screen.queryByRole('button', { name: '联网专家' })).toBeNull()
  else {
    const card = screen.getByRole('button', { name: '联网专家' }) as HTMLButtonElement
    expect(card.disabled).toBe(true)
    expect(card.title).toBe('当前网络环境不可达，请检查您的网络')
    fireEvent.click(card)
    expect(screen.queryByRole('dialog')).toBeNull()
  }
  expect(launchExpert).not.toHaveBeenCalled()
  expect([...view.container.querySelectorAll<HTMLButtonElement>('.dsh-expert-card')]
    .map(button => ({ name: button.textContent, disabled: button.disabled, hint: button.title }))).toMatchSnapshot()
  const onlineState = { ...state, directInternet: true }
  view.rerender(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert}
    network={{ subscribe, getSnapshot: () => onlineState }} />)
  await waitFor(() => expect((screen.getByRole('button', { name: '联网专家' }) as HTMLButtonElement).disabled).toBe(false))
})
