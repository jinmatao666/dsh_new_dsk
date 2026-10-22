/** Shared document nodes, history and external-text sanitation for all composer entry paths. */
import { createEditor } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import { mergeRegister } from '@lexical/utils'
import { ReferenceChipNode } from './chip-node.tsx'
import { TextRefNode } from './text-ref.ts'

/**
 * Create the shared editor used by staged and live conversation drafts.
 * @returns An unbound composer editor with the standard reference node types.
 */
export function createComposerEditor(): LexicalEditor {
  return createEditor({ namespace: 'dsh-composer', nodes: [ReferenceChipNode, TextRefNode],
    onError: (error) => { throw error } })
}

/**
 * Register plain-text editing and the shared typing-history window.
 * @param editor - Owned composer editor.
 * @returns Cleanup for document commands and history.
 */
export function registerComposerDocument(editor: LexicalEditor): () => void {
  return mergeRegister(registerPlainText(editor), registerHistory(editor, createEmptyHistoryState(), 1000))
}

/**
 * Remove detect-only and legacy reference placeholders from external text.
 * @param text - Clipboard or persisted draft text, never the detect projection.
 * @returns Text safe to insert as ordinary editable content.
 */
export function cleanComposerText(text: string): string {
  return text.replace(/[\uE100-\uE11D\uFFFC]/gu, '')
}
