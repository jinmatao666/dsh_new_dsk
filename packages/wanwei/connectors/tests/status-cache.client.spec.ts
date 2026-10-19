// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearCachedDingTalkStatus,
  getCachedDingTalkStatus,
  setCachedDingTalkStatus,
  subscribeDingTalkStatusCache,
} from '../src/client/status-cache.ts'
import type { DingTalkStatus } from '../src/client/DingTalkPanel.tsx'

afterEach(() => {
  clearCachedDingTalkStatus()
})

const sample: DingTalkStatus = {
  dwsInstalled: true,
  dwsVersion: null,
  authed: true,
  skillInstalled: true,
  hint: null,
}

describe('DingTalk status cache', () => {
  it('persists status for instant reconnect UI', () => {
    const listener = vi.fn()
    const stop = subscribeDingTalkStatusCache(listener)
    setCachedDingTalkStatus(sample)
    expect(getCachedDingTalkStatus()).toEqual(sample)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('wanwei.dingtalk.dwsStatus') ?? 'null')).toEqual(sample)
    clearCachedDingTalkStatus()
    expect(getCachedDingTalkStatus()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
  })
})
