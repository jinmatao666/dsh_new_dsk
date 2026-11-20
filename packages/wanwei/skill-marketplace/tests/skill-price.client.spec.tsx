// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SkillPrice } from '../src/client/SkillPrice.tsx'

afterEach(cleanup)

it('shows the positive price with a gold coin and charge point name on hover', () => {
  const { container } = render(<SkillPrice credits={3} enabled />)
  expect(screen.getByText('3')).toBeTruthy()
  expect(container.textContent).toBe('3')
  expect(screen.getByText('3').title).toBe('技能调用')
  expect(container.querySelector('.dsh-skill-price-icon')?.getAttribute('stroke')).toBe('#d99a22')
})

it('keeps separate named prices and respects an empty server price list', () => {
  const { container, rerender } = render(<SkillPrice credits={99} enabled points={[
    { name: '生成报告', credits: 3 }, { name: '导出成果', credits: 0.5 }, { name: '预览', credits: 0 },
  ]} />)
  expect(screen.getByText('3').title).toBe('生成报告')
  expect(screen.getByText('0.5').title).toBe('导出成果')
  expect(container.textContent).toBe('30.5')
  rerender(<SkillPrice credits={99} enabled points={[]} />)
  expect(container.textContent).toBe('')
})

it('hides zero, absent prices and disabled accounting', () => {
  const { container, rerender } = render(<SkillPrice credits={0} enabled />)
  expect(container.innerHTML).toBe('')
  rerender(<SkillPrice credits={undefined} enabled />)
  expect(container.innerHTML).toBe('')
  rerender(<SkillPrice credits={3} enabled={false} />)
  expect(container.innerHTML).toBe('')
})
