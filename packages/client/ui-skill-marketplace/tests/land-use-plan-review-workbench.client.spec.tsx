// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LandUsePlanReviewWorkbench } from '../src/client/LandUsePlanReviewWorkbench.tsx'

afterEach(cleanup)

describe('land use plan review expert workbench', () => {
  it('shows its own business copy and keeps review parameters explicit', async () => {
    render(<LandUsePlanReviewWorkbench />)
    expect(screen.getByText('规划符合性与用途管制审查')).toBeTruthy()
    fireEvent.click(within(document.querySelector('main') as HTMLElement).getByRole('button', { name: '＋ 新建分析' }))
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }))
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('4')
    expect(screen.queryByText(/三调地类/)).toBeNull()
  })
})
