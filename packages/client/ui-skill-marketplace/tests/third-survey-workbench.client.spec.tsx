// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThirdSurveyWorkbench } from '../src/client/ThirdSurveyWorkbench.tsx'

afterEach(cleanup)

describe('third survey expert workbench', () => {
  it('shows its own business copy and validates a real project range', async () => {
    render(<ThirdSurveyWorkbench />)
    expect(screen.getByText('三调地类、面积与权属现状分析')).toBeTruthy()
    fireEvent.click(within(document.querySelector('main') as HTMLElement).getByRole('button', { name: '＋ 新建分析' }))
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }))
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('2024')
    fireEvent.click(screen.getByRole('button', { name: /核对分析信息/ }))
    expect(screen.getByRole('alert').textContent).toContain('请选择地块范围文件')
  })
})
