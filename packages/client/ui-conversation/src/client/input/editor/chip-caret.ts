/** Paint element-point carets beside atomic references without inserting draft text. */
import type { LexicalEditor } from 'lexical'
import { $getSelection, $isElementNode, $isRangeSelection } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { $isReferenceChipNode } from './chip-node.tsx'
import css from './ReferenceChip.module.css'

/**
 * Keep reference-edge carets visible when WebKit cannot paint an element point.
 * @param editor - Composer editor whose root and selection own the decoration.
 * @returns Cleanup for DOM markers and editor/focus listeners.
 */
export function registerChipCaret(editor: LexicalEditor): () => void {
  let root: HTMLElement | null = null
  let marked: HTMLElement | null = null
  const clear = (): void => {
    marked?.removeAttribute('data-composer-caret')
    marked = null
    root?.classList.remove(css.boundaryCaret ?? 'boundaryCaret')
  }
  const sync = (): void => {
    clear()
    if (root === null || !editor.isEditable() || root.ownerDocument.activeElement !== root) return
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== 'element') return
      const parent = selection.anchor.getNode()
      if (!$isElementNode(parent)) return
      const next = parent.getChildAtIndex(selection.anchor.offset)
      const previous = parent.getChildAtIndex(selection.anchor.offset - 1)
      const chip = $isReferenceChipNode(next) ? next : $isReferenceChipNode(previous) ? previous : null
      if (chip === null) return
      marked = editor.getElementByKey(chip.getKey())
      if (marked === null) return
      marked.setAttribute('data-composer-caret', chip === next ? 'before' : 'after')
      root?.classList.add(css.boundaryCaret ?? 'boundaryCaret')
    })
  }
  return mergeRegister(
    editor.registerUpdateListener(sync),
    editor.registerEditableListener(sync),
    editor.registerRootListener((next, previous) => {
      clear()
      previous?.classList.remove(css.surface ?? 'surface')
      previous?.removeEventListener('focus', sync)
      previous?.removeEventListener('blur', clear)
      root = next
      next?.classList.add(css.surface ?? 'surface')
      next?.addEventListener('focus', sync)
      next?.addEventListener('blur', clear)
      sync()
    }),
    () => {
      clear()
      root?.classList.remove(css.surface ?? 'surface')
      root?.removeEventListener('focus', sync)
      root?.removeEventListener('blur', clear)
      root = null
    },
  )
}
