// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExpertMarket } from '../src/client/ExpertMarket.tsx'
import type { NetworkState } from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import { internetCatalogAccess } from '../../oneapi-auth/src/network-contract.ts'

afterEach(cleanup)
it.each(['hide', 'disable'] as const)('uses %s for internet experts and restores them after a successful probe', async (internetCatalogPolicy) => {
  const loadExperts = async () => [
    { key: 'online-expert', name: '联网专家', requires_internet: true, workbench_url: 'https://example.com/' },
    { key: 'offline-expert', name: '内网专家', requires_internet: false, workbench_url: 'http://expert.lan/' },
  ]
  const launchExpert = vi.fn(async () => ({ url: 'https://example.com/', ticket: 'ticket' }))
  const state: NetworkState = { mode: 'intranet', internalOrigins: [], directInternet: false, internetCatalogPolicy: 'disable',
    internetExpertPolicy: internetCatalogPolicy, internetSkillPolicy: internetCatalogPolicy === 'hide' ? 'disable' : 'hide' }
  const subscribe = () => () => {}
  const view = render(<ExpertMarket loadExperts={loadExperts} launchExpert={launchExpert}
    network={{ subscribe, catalogAccess: internetCatalogAccess, getSnapshot: () => state }} />)
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
    network={{ subscribe, catalogAccess: internetCatalogAccess, getSnapshot: () => onlineState }} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: '联网专家' })).toHaveProperty('disabled', false) })
})

it('refreshes administrator card and category ordering without restarting the library', async () => {
  const first = { key: 'first-expert', name: '首位专家', category: '办公工具', category_order: 1, workbench_url: 'https://example.com/first' }
  const second = { key: 'second-expert', name: '次位专家', category: '空间分析', category_order: 0, workbench_url: 'https://example.com/second' }
  let entries = [first, second]
  const loadExperts = vi.fn(async () => entries)
  const view = render(<ExpertMarket loadExperts={loadExperts} />)
  await screen.findByRole('button', { name: '首位专家' })
  const cards = () => [...view.container.querySelectorAll('.dsh-expert-card strong')].map(node => node.textContent)
  const categories = () => [...view.container.querySelectorAll('.dsh-expert-category-row button')].map(node => node.textContent)
  expect(cards()).toEqual(['首位专家', '次位专家'])
  expect(categories()).toEqual(['全部', '空间分析', '办公工具'])
  entries = [{ ...second, category_order: 1 }, { ...first, category_order: 0 }]
  fireEvent.click(screen.getByRole('button', { name: '刷新目录' }))
  await waitFor(() => { expect(cards()).toEqual(['次位专家', '首位专家']) })
  expect(categories()).toEqual(['全部', '办公工具', '空间分析'])
  expect(loadExperts).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '办公工具' }))
  expect(cards()).toEqual(['首位专家'])
})
