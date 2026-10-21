// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode, $createTextNode, $getRoot, $setSelection, createEditor, KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND,
} from 'lexical'
import { $createReferenceChipNode, ReferenceChipNode } from '../src/client/input/editor/chip-node.tsx'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'
import { $projectComposer } from '../src/client/input/editor/projection.ts'
import { $selectDetectSpan } from '../src/client/input/editor/span-map.ts'

function bench(appearance: 'skill' | 'folder', separator = ' ') {
  const editor = createEditor({ nodes: [ReferenceChipNode], onError: (e) => { throw e } })
  const unregister = registerComposerKeymap(editor, {
    arbitrate: () => 'pass', space: () => false, dismissPopup() {}, canSubmit: () => false,
    submit() {}, intakeFiles() {}, pasteText() {},
  })
  editor.update(() => {
    const ref = { source: 'test', ref: 'one', label: 'one', clipboardText: '@one', appearance }
    $getRoot().append($createParagraphNode().append(
      $createReferenceChipNode(ref), $createTextNode(separator),
      $createReferenceChipNode({ ...ref, ref: 'two', label: 'two', clipboardText: '@two' }),
      $createTextNode(' question'),
    ))
  }, { discrete: true })
  const move = (from: number, backward = false, init: KeyboardEventInit = {}) => {
    let handled = false
    editor.update(() => {
      $selectDetectSpan({ start: from, end: from })
      handled = editor.dispatchCommand(backward ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND,
        new KeyboardEvent('keydown', { key: backward ? 'ArrowLeft' : 'ArrowRight', cancelable: true, ...init }))
    }, { discrete: true })
    return { handled, caret: editor.getEditorState().read(() => $projectComposer(() => 1).caret) }
  }
  return { editor, move, unregister }
}

describe('reference boundary navigation', () => {
  it.each(['skill', 'folder'] as const)('stops repeated outward arrows at %s document edges without changing text', (appearance) => {
    const { editor, move, unregister } = bench(appearance)
    for (let count = 0; count < 4; count++) {
      expect(move(0, true)).toEqual({ handled: true, caret: 0 })
      expect(move(12)).toEqual({ handled: true, caret: 12 })
    }
    expect(editor.getEditorState().read(() => $projectComposer(() => 1).clipboardText)).toBe('@one @two question')
    unregister()
  })

  it.each(['skill', 'folder'] as const)('crosses %s and its separator in one arrow step', (appearance) => {
    const { editor, move, unregister } = bench(appearance)
    expect(move(0)).toEqual({ handled: true, caret: 2 })
    expect(move(2, true)).toEqual({ handled: true, caret: 0 })
    expect(move(2)).toEqual({ handled: true, caret: 4 })
    expect(move(4, true)).toEqual({ handled: true, caret: 2 })
    expect(move(1)).toEqual({ handled: true, caret: 2 })
    expect(move(1, true)).toEqual({ handled: true, caret: 0 })
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('@one @two question')
    unregister()
    expect(move(0).handled).toBe(false)
  })

  it('keeps adjacent references individually navigable without text separators', () => {
    const { move } = bench('folder', '')
    expect(move(0)).toEqual({ handled: true, caret: 1 })
    expect(move(1, true)).toEqual({ handled: true, caret: 0 })
  })

  it('preserves repeated user spaces as separate positions', () => {
    const { move } = bench('skill', '  ')
    expect(move(0)).toEqual({ handled: true, caret: 1 })
    expect(move(2).handled).toBe(false)
  })

  it.each([{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }])('leaves modified or composing gestures to the editor: %j', (init) => {
    expect(bench('skill').move(0, false, init)).toEqual({ handled: false, caret: 0 })
  })

  it('does not intercept text, range selections or absent selections', () => {
    const { editor, move } = bench('skill')
    expect(move(6).handled).toBe(false)
    editor.update(() => {
      $selectDetectSpan({ start: 0, end: 2 })
      expect(editor.dispatchCommand(KEY_ARROW_RIGHT_COMMAND, new KeyboardEvent('keydown'))).toBe(false)
      $setSelection(null)
      expect(editor.dispatchCommand(KEY_ARROW_LEFT_COMMAND, new KeyboardEvent('keydown'))).toBe(false)
    }, { discrete: true })
  })
})
