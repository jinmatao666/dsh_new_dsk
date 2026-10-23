// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getActiveConnectorId,
  getActiveConnectorIds,
  removeActiveConnectorId,
  setActiveConnectorId,
  subscribeActiveConnector,
  toggleActiveConnectorId,
} from '../src/client/active-connector.ts'

afterEach(() => {
  setActiveConnectorId(null)
})

describe('active-connector', () => {
  it('notifies subscribers when the selected connector changes', () => {
    const listener = vi.fn()
    const stop = subscribeActiveConnector(listener)
    setActiveConnectorId('dingtalk')
    expect(getActiveConnectorId()).toBe('dingtalk')
    expect(getActiveConnectorIds()).toEqual(['dingtalk'])
    expect(listener).toHaveBeenCalledTimes(1)
    setActiveConnectorId('dingtalk')
    expect(listener).toHaveBeenCalledTimes(1)
    setActiveConnectorId(null)
    expect(getActiveConnectorId()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    setActiveConnectorId('dingtalk')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps multiple attached connectors and can toggle or remove one', () => {
    setActiveConnectorId('dingtalk')
    setActiveConnectorId('wechat')
    expect(getActiveConnectorIds()).toEqual(['dingtalk', 'wechat'])
    toggleActiveConnectorId('dingtalk')
    expect(getActiveConnectorIds()).toEqual(['wechat'])
    removeActiveConnectorId('wechat')
    expect(getActiveConnectorIds()).toEqual([])
  })
})
