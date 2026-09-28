// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { SkillDraftPrefix } from '../src/client/plugin.tsx'
import { rememberSkillDisplayNames } from '../src/client/skill-use.ts'

afterEach(() => { cleanup(); localStorage.clear() })

function bench(sessionReady = false) {
  rememberSkillDisplayNames([{ slug: 'office-images-to-pdf', displayName: '图片转 PDF' }])
  const removePrefix = vi.fn()
  const settlePrefix = vi.fn(() => sessionReady)
  const renderInput = vi.fn((length = 0, prefix?: ReactNode) => <div data-inline-draft>{prefix}<span data-draft-text>{length > 0 ? '你好' : '/office-images-to-pdf 你好'}</span></div>)
  const bubble = vi.fn()
  const props = { draft: '/office-images-to-pdf 你好', sessionReady, removePrefix, settlePrefix, renderInput } as unknown as ComponentProps<typeof SkillDraftPrefix>
  return { ...render(<div onClick={bubble}><SkillDraftPrefix {...props} /></div>), removePrefix, settlePrefix, renderInput, bubble }
}

describe('skill prefix presentation', () => {
  it('renders a compact SVG chip beside staged text without a duplicate slash token', () => {
    const view = bench()
    expect(view.container.textContent).toBe('图片转 PDF×你好')
    expect(view.container.querySelector('button svg')).not.toBeNull()
    fireEvent.click(view.getByRole('button'))
    expect(view.removePrefix).toHaveBeenCalledWith('/office-images-to-pdf'.length)
    expect(view.bubble).not.toHaveBeenCalled()
  })

  it('settles the token to a Session chip and leaves the editor as the only display', () => {
    const view = bench(true)
    expect(view.settlePrefix).toHaveBeenCalledWith('/office-images-to-pdf'.length, expect.objectContaining({ source: 'skill', ref: '/office-images-to-pdf', label: '图片转 PDF', appearance: 'skill' }))
    expect(view.container.querySelector('button')).toBeNull()
    expect(view.renderInput).toHaveBeenCalledWith()
  })
})
