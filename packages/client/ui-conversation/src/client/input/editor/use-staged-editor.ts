/** Pre-Session editing uses the same document, references and keymap as a Session, without creating one. */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, HISTORY_MERGE_TAG, PASTE_TAG } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { cleanComposerText, createComposerEditor, registerComposerDocument } from './document.ts'
import { registerComposerKeymap } from './keymap.ts'
import { $composerLayout, $projectComposer } from './projection.ts'
import { $createReferenceChipNode } from './chip-node.tsx'
import { $replaceDetectSpanWithNodes, $replaceDetectSpanWithText } from './span-map.ts'
import type { DraftInputTriggers, Occurrence } from '../../contract/input.ts'

interface StagedEditorOptions {
  active: boolean
  text: string
  editable: boolean
  triggers?: DraftInputTriggers | undefined
  onReferences?: ((text: string, references: readonly Occurrence[]) => void) | undefined
  onChange?: ((text: string) => void) | undefined
  onSubmit?: (() => Promise<void>) | undefined
  onError: (text: string) => void
}

/**
 * Own the local pre-Session document; external echoes preserve its nodes and selection.
 * @param options - Draft owner callbacks and current editability.
 * @returns The local editor while staging, otherwise null.
 */
export function useStagedEditor(options: StagedEditorOptions): LexicalEditor | null {
  const latest = useRef(options)
  latest.current = options
  const editor = useMemo(() => options.active ? createComposerEditor() : null, [options.active])
  useLayoutEffect(() => {
    if (editor === null) return
    const triggers = options.triggers
    let revision = 0
    let content = ''
    return mergeRegister(
      registerComposerDocument(editor),
      triggers?.bindEditor((outcome, span) => {
        if (!latest.current.editable || span.draftRev !== revision || outcome === undefined || outcome === 'handled' || 'claim' in outcome) return false
        let applied = false
        editor.update(() => {
          if ('text' in outcome) applied = $replaceDetectSpanWithText(span, cleanComposerText(outcome.text))
          else {
            const tail = $composerLayout().detectText.slice(span.end, span.end + 1)
            const nodes = [$createReferenceChipNode(outcome.insert)]
            applied = $replaceDetectSpanWithNodes(span, tail === ' ' ? nodes : [...nodes, $createTextNode(' ')])
          }
        }, { discrete: true })
        return applied
      }) ?? (() => {}),
      editor.registerUpdateListener(({ editorState }) => {
        const projection = editorState.read(() => $projectComposer(() => 0))
        const text = projection.clipboardText
        const next = JSON.stringify([projection.detectText, text])
        if (next !== content) { content = next; revision += 1 }
        if (text !== latest.current.text) latest.current.onChange?.(text)
        latest.current.onReferences?.(text, projection.occurrences)
        if (projection.caret !== null) triggers?.track(projection.detectText, projection.caret,
          { tier: latest.current.editable ? 'plain' : 'frozen' }, revision)
      }),
      registerComposerKeymap(editor, {
        arbitrate: (key, composing) => triggers?.arbitrate(key, composing) ?? 'pass',
        space: () => triggers?.onSpace() ?? false,
        dismissPopup: () => { triggers?.dismiss() },
        canSubmit: () => latest.current.editable && latest.current.onSubmit !== undefined && latest.current.text.trim() !== '',
        submit: () => { void latest.current.onSubmit?.().catch((error: unknown) => {
          latest.current.onError(error instanceof Error ? error.message : String(error))
        }) },
        intakeFiles: () => {},
        pasteText: (text) => {
          if (!latest.current.editable) return
          const clean = cleanComposerText(text)
          if (clean === '') return
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) selection.insertText(clean)
            else $getRoot().selectEnd().insertText(clean)
          }, { tag: PASTE_TAG })
        },
      }),
    )
  }, [editor, options.triggers])
  useLayoutEffect(() => {
    if (editor === null) return
    const text = cleanComposerText(options.text)
    if (editor.getEditorState().read(() => $composerLayout().clipboardText) === text) return
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      for (const line of text.split('\n')) {
        const paragraph = $createParagraphNode()
        if (line !== '') paragraph.append($createTextNode(line))
        root.append(paragraph)
      }
      root.selectEnd()
    }, { discrete: true, tag: HISTORY_MERGE_TAG })
  }, [editor, options.text])
  return editor
}
