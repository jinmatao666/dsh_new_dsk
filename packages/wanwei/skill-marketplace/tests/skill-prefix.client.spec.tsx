// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SkillDraftPrefix } from '../src/client/plugin.tsx'
import { rememberSkillDisplayNames } from '../src/client/skill-use.ts'

afterEach(() => { cleanup(); localStorage.clear() })

describe('skill prefix presentation', () => {
  it('delegates staged and live presentation to the same editor reference node', () => {
    rememberSkillDisplayNames([{ slug: 'office-images-to-pdf', displayName: '图片转 PDF' }])
    const settlePrefix = vi.fn(() => true)
    const renderInput = vi.fn(() => <div data-editor />)
    const props = { draft: '/office-images-to-pdf 你好', settlePrefix, renderInput } as ComponentProps<typeof SkillDraftPrefix>
    const view = render(<SkillDraftPrefix {...props} />)
    expect(settlePrefix).toHaveBeenCalledWith('/office-images-to-pdf'.length, expect.objectContaining({ source: 'skill', ref: '/office-images-to-pdf', label: '图片转 PDF', appearance: 'skill' }))
    expect(renderInput).toHaveBeenCalledWith()
    expect(view.container.querySelector('[data-editor]')).not.toBeNull()
    expect(view.container.querySelector('button')).toBeNull()
  })

  it('leaves unknown slash text untouched', () => {
    const settlePrefix = vi.fn(() => false)
    const renderInput = vi.fn(() => <div data-editor />)
    const props = { draft: '/unknown 你好', settlePrefix, renderInput } as ComponentProps<typeof SkillDraftPrefix>
    render(<SkillDraftPrefix {...props} />)
    expect(settlePrefix).not.toHaveBeenCalled()
    expect(renderInput).toHaveBeenCalledWith()
  })
})
