// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { setActiveConnectorId } from '../src/client/active-connector.ts'
import { ComposerConnectorChip } from '../src/client/ComposerConnectorChip.tsx'

afterEach(() => {
  cleanup()
  setActiveConnectorId(null)
})

const options = [
  {
    id: 'feishu',
    name: '飞书',
    icon: '/connector-icons/feishu.png',
    accent: '#00aeef',
    available: false,
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    icon: '/connector-icons/dingtalk.png',
    accent: '#1677ff',
    available: true,
  },
  {
    id: 'wecom',
    name: '企业微信',
    icon: '/connector-icons/wecom.png',
    accent: '#2b7de9',
    available: true,
  },
] as const

describe('ComposerConnectorChip', () => {
  it('stays hidden until a connector is selected', () => {
    render(<ComposerConnectorChip options={options} onManage={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /当前连接器/ })).toBeNull()
  })

  it('stacks every active icon and sorts selected, then connected, then connect CTAs', () => {
    setActiveConnectorId('wecom')
    const onManage = vi.fn()
    render(<ComposerConnectorChip options={options} onManage={onManage} />)
    const trigger = screen.getByRole('button', { name: '当前连接器：企业微信' })
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe('/connector-icons/wecom.png')
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: '切换连接器' })
    const rows = within(menu).getAllByRole('menuitem').filter(node => node.classList.contains('dsh-composer-connector-row'))
    expect(rows.map(row => row.textContent)).toEqual([
      '企业微信',
      '钉钉',
      '飞书连接',
    ])
    expect(screen.getByRole('switch', { name: '钉钉' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: '企业微信' }).getAttribute('aria-checked')).toBe('true')
    const connect = screen.getByRole('button', { name: '连接' })
    expect(connect.querySelector('svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '管理连接器' }))
    expect(onManage).toHaveBeenCalled()
  })

  it('keeps remaining chips when one active switch is turned off', () => {
    setActiveConnectorId('dingtalk')
    setActiveConnectorId('wecom')
    render(<ComposerConnectorChip options={options} onManage={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '当前连接器：钉钉、企业微信' }))
    fireEvent.click(screen.getByRole('switch', { name: '钉钉' }))
    expect(screen.getByRole('button', { name: '当前连接器：企业微信' })).toBeTruthy()
  })
})
