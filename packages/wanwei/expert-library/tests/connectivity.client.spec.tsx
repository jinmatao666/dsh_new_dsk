// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ExpertMarket } from '../src/client/ExpertMarket.tsx'

afterEach(cleanup)
it('reloads the catalog after a dropped local check and keeps the illustration only while the service stays down', async () => {
  const loadExperts = vi.fn(async () => [{ key: 'test-expert', name: '测试专家', workbench_url: 'http://expert.lan/' }])
  loadExperts.mockRejectedValueOnce(new Error('Failed to fetch'))
  const recovered = render(<ExpertMarket loadExperts={loadExperts} />)
  expect(await screen.findByRole('button', { name: '测试专家' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '暂时无法连接专家库' })).toBeNull()
  recovered.unmount()

  loadExperts.mockReset()
  loadExperts.mockRejectedValue(new Error('专家服务连接失败'))
  const view = render(<ExpertMarket loadExperts={loadExperts} />)
  expect(await screen.findByRole('heading', { name: '暂时无法连接专家库' })).toBeTruthy()
  expect(screen.queryByText('当前暂无已上架的专家。')).toBeNull()
  expect(screen.getByRole('alert').textContent).toMatchInlineSnapshot('"暂时无法连接专家库当前网络无法连接专家服务，请检查网络连接或联系管理员。"')
  expect(screen.getByRole('alert').classList.contains('wanwei-service-unavailable-experts')).toBe(true)
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull()
  view.unmount()
  loadExperts.mockReset()
  loadExperts.mockResolvedValue([{ key: 'test-expert', name: '测试专家', workbench_url: 'http://expert.lan/' }])
  render(<ExpertMarket loadExperts={loadExperts} />)
  expect(await screen.findByRole('button', { name: '测试专家' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
