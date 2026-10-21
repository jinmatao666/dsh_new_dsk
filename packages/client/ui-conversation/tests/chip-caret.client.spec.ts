// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { $createParagraphNode, $createTextNode, $getRoot, $setSelection, createEditor } from 'lexical'
import { ReferenceChipNode, $createReferenceChipNode } from '../src/client/input/editor/chip-node.tsx'
import { registerChipCaret } from '../src/client/input/editor/chip-caret.ts'
import { $selectDetectSpan } from '../src/client/input/editor/span-map.ts'
import { $projectComposer } from '../src/client/input/editor/projection.ts'

afterEach(() => { document.body.replaceChildren() })

// jsdom has no Range geometry; real browser checks exercise caret placement.
Range.prototype.getBoundingClientRect = () => new DOMRect()

function bench(appearance: 'skill' | 'folder') {
  const editor = createEditor({ nodes: [ReferenceChipNode], onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  root.tabIndex = 0
  document.body.append(root)
  const unregister = registerChipCaret(editor)
  editor.setRootElement(root)
  root.focus()
  editor.update(() => {
    $getRoot().append($createParagraphNode().append($createReferenceChipNode({
      source: appearance, ref: 'test', label: 'test', clipboardText: '@test', appearance,
    })))
    $selectDetectSpan({ start: 0, end: 0 })
  }, { discrete: true })
  const chip = root.querySelector('[data-composer-chip]')!
  const caret = (start: number, end = start): void => {
    editor.update(() => { $selectDetectSpan({ start, end }) }, { discrete: true })
  }
  return { editor, root, chip, caret, unregister }
}

describe('reference element-point carets', () => {
  it.each(['skill', 'folder'] as const)('paints both %s edges without adding draft or clipboard characters', (appearance) => {
    const { editor, root, chip, caret, unregister } = bench(appearance)
    expect(chip.getAttribute('data-composer-caret')).toBe('before')
    caret(1)
    expect(chip.getAttribute('data-composer-caret')).toBe('after')
    expect(editor.getEditorState().read(() => $projectComposer(() => 1).clipboardText)).toBe('@test')
    expect(root.textContent).toBe('')
    root.blur()
    expect(chip.hasAttribute('data-composer-caret')).toBe(false)
    root.focus()
    expect(chip.getAttribute('data-composer-caret')).toBe('after')
    editor.setEditable(false)
    expect(chip.hasAttribute('data-composer-caret')).toBe(false)
    editor.setEditable(true)
    expect(chip.getAttribute('data-composer-caret')).toBe('after')
    caret(0, 1)
    expect(chip.hasAttribute('data-composer-caret')).toBe(false)
    caret(0)
    unregister()
    expect(chip.hasAttribute('data-composer-caret')).toBe(false)
    root.blur(); root.focus(); caret(1)
    expect(chip.hasAttribute('data-composer-caret')).toBe(false)
    editor.setRootElement(null)
  })

  it('uses native text carets and clears decorations for absent selection or root replacement', () => {
    const { editor, root, chip, caret, unregister } = bench('skill')
    editor.update(() => {
      $getRoot().getFirstChildOrThrow().insertAfter($createParagraphNode().append($createTextNode('text')))
    }, { discrete: true })
    caret(3)
    expect(chip.hasAttribute('data-composer-caret')).toBe(false)
    caret(0)
    editor.update(() => { $setSelection(null) }, { discrete: true })
    expect(chip.hasAttribute('data-composer-caret')).toBe(false)
    caret(0)
    const replacement = document.createElement('div')
    document.body.append(replacement)
    editor.setRootElement(replacement)
    expect(root.querySelector('[data-composer-caret]')).toBeNull()
    unregister()
    editor.setRootElement(null)
  })
})
