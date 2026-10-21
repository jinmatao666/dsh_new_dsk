// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DraftSkillPicker } from '../src/client/DraftSkillPicker.tsx'
import type { ComponentProps } from 'react'

afterEach(cleanup)
it('offers installed skills before choosing a Workspace and stages the selected skill', async () => {
  const choose = vi.fn()
  const load = vi.fn(async () => [{ name: 'risk-check', displayName: '项目风险清单' }])
  render(<DraftSkillPicker {...{ sessionId: undefined, load, choose } as ComponentProps<typeof DraftSkillPicker>} />)
  fireEvent.click(await screen.findByRole('combobox', { name: '选择技能' }))
  fireEvent.click(await screen.findByRole('option', { name: '项目风险清单' }))
  expect(choose).toHaveBeenCalledWith({ name: 'risk-check', displayName: '项目风险清单' })
})
