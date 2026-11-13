// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SkillPrice } from '../src/client/SkillPrice.tsx'

afterEach(cleanup)

it('shows only the configured positive number and the official icon', () => {
  const { container } = render(<SkillPrice credits={3} enabled />)
  expect(screen.getByText('3')).toBeTruthy()
  expect(container.textContent).toBe('3')
  expect(container.querySelector('.dsh-skill-price-icon')?.getAttribute('style')).toContain('data:image/svg+xml')
})

it('hides zero, absent prices and disabled accounting', () => {
  const { container, rerender } = render(<SkillPrice credits={0} enabled />)
  expect(container.innerHTML).toBe('')
  rerender(<SkillPrice credits={undefined} enabled />)
  expect(container.innerHTML).toBe('')
  rerender(<SkillPrice credits={3} enabled={false} />)
  expect(container.innerHTML).toBe('')
})
