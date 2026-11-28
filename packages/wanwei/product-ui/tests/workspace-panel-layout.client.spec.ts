import { describe, expect, it } from 'vitest'
import { workspacePanelLayout } from '../src/client/workspace-panel-layout.ts'

describe('workspace panel geometry', () => {
  it('keeps at least 600 px for conversation when docking previews', () => {
    for (const available of [900, 1050, 1180, 1570]) {
      const panel = workspacePanelLayout(available, available + 350, true, 520)
      expect(available - panel.reserved).toBeGreaterThanOrEqual(600)
      expect(panel.width).toBeLessThanOrEqual(available)
    }
  })
  it('uses a drawer instead of squeezing a small window', () => {
    const panel = workspacePanelLayout(650, 1000, true, 520)
    expect(panel.mode).toBe('overlay')
    expect(panel.reserved).toBe(0)
    expect(panel.width).toBeLessThan(650)
  })
  it('returns to just the file tree when a preview closes', () => {
    expect(workspacePanelLayout(1050, 1400, false, 520)).toEqual({ mode: 'tree', width: 240, tree: 240, reserved: 240 })
  })
})
