// @vitest-environment jsdom
/**
 * ReferenceChip visual face: icon selection per appearance, the trigger
 * marker fallback, label truncation container, and invalid styling.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { ReferenceChip } from '../src/client/input/editor/ReferenceChip.tsx'
import { ReferenceChipNode, $createReferenceChipNode } from '../src/client/input/editor/chip-node.tsx'
import { DecoratorPortals } from '../src/client/input/editor/DecoratorPortals.tsx'

afterEach(cleanup)

describe('ReferenceChip', () => {
  it('removes only the selected Lexical occurrence and preserves the question and other skills', async () => {
    const editor = createEditor({ nodes: [ReferenceChipNode], onError: (error) => { throw error } })
    const host = document.createElement('div')
    document.body.append(host)
    editor.setRootElement(host)
    const open = vi.fn<(event: WindowEventMap['dsh:reference-open']) => void>()
    window.addEventListener('dsh:reference-open', open)
    const view = render(<DecoratorPortals editor={editor} />)
    try {
      editor.update(() => {
        const reference = { source: 'skill', ref: '/excel', clipboardText: '/excel', label: 'Excel 数据处理', appearance: 'skill' as const }
        $getRoot().append($createParagraphNode().append(
          $createReferenceChipNode(reference), $createTextNode(' 清理客户台账 '),
          $createReferenceChipNode({ ...reference, ref: '/pdf', clipboardText: '/pdf', label: 'PDF 转图片' }),
        ))
      }, { discrete: true })
      const name = await view.findByRole('button', { name: 'Excel 数据处理' })
      fireEvent.click(name)
      expect(open.mock.calls[0]![0].detail).toEqual({ source: 'skill', ref: '/excel' })
      expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('/excel 清理客户台账 /pdf')
      editor.setEditable(false)
      fireEvent.click(view.getByRole('button', { name: '× Excel 数据处理' }))
      expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('/excel 清理客户台账 /pdf')
      editor.setEditable(true)
      fireEvent.click(view.getByRole('button', { name: '× Excel 数据处理' }))
      await waitFor(() => {
        expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(' 清理客户台账 /pdf')
      })
      expect(view.getByRole('button', { name: 'PDF 转图片' })).toBeTruthy()
    } finally {
      window.removeEventListener('dsh:reference-open', open)
      view.unmount()
      editor.setRootElement(null)
      host.remove()
    }
  })
  it('separates opening a skill from removing its reference', () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    const bubble = vi.fn()
    const keyBubble = vi.fn()
    const view = render(<div onClick={bubble} onKeyDown={keyBubble}><ReferenceChip label="Excel 数据处理" appearance="skill" invalid={false} onOpen={onOpen} onRemove={onRemove} /></div>)
    expect(view.container.firstElementChild).toMatchSnapshot()
    fireEvent.click(view.getByRole('button', { name: 'Excel 数据处理' }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '× Excel 数据处理' }))
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledOnce()
    expect(bubble).not.toHaveBeenCalled()
    const remove = view.getByRole('button', { name: '× Excel 数据处理' })
    fireEvent.keyDown(remove, { key: 'Enter' })
    fireEvent.keyDown(remove, { key: ' ' })
    expect(keyBubble).not.toHaveBeenCalled()
    fireEvent.keyDown(remove, { key: 'ArrowLeft' })
    expect(keyBubble).toHaveBeenCalledOnce()
  })
  it('renders the domain icon and the label', () => {
    const { container, getByTitle } = render(
      <ReferenceChip label="Research notes" appearance="session" invalid={false} />,
    )
    expect(getByTitle('Research notes')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toBe('Research notes')
  })

  it('falls back to the trigger marker without an appearance', () => {
    const { container } = render(<ReferenceChip label="commit-helper" invalid={false} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('@commit-helper')
  })

  it('applies the invalid styling bit', () => {
    const { container } = render(<ReferenceChip label="gone" appearance="folder" invalid />)
    const chip = container.firstElementChild
    expect(chip).not.toBeNull()
    expect([...(chip?.classList ?? [])].some(name => name.includes('invalid'))).toBe(true)
  })
})
