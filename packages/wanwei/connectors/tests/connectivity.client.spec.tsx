// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Connectors } from '../src/client/plugin.tsx'

afterEach(cleanup)
it('shows a connector illustration without retry controls and checks again on reopening', async () => {
  const checkConnection = vi.fn(async () => {})
  checkConnection.mockRejectedValueOnce(new Error('平台服务连接失败'))
  const view = render(<Connectors checkConnection={checkConnection} />)
  expect(await screen.findByRole('heading', { name: '暂时无法连接连接器服务' })).toBeTruthy()
  expect(screen.queryByText('钉钉')).toBeNull()
  expect(screen.getByRole('alert').textContent).toMatchInlineSnapshot('"暂时无法连接连接器服务当前网络无法连接该服务，请检查网络连接或联系管理员。"')
  expect(screen.getByRole('alert').classList.contains('wanwei-service-unavailable-connectors')).toBe(true)
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull()
  view.unmount()
  render(<Connectors checkConnection={checkConnection} />)
  expect(await screen.findByText('钉钉')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(checkConnection).toHaveBeenCalledTimes(2)
})
