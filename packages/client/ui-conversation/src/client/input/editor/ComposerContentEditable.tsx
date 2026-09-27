/**
 * The composer's contenteditable host: binds one shell-owned Lexical editor
 * to a resident div. Session-maybe by design — a null editor renders the
 * same DOM inert (the no-session Workspace-trigger state), so switching
 * between the two never swaps the element tree. Editability has ONE writer:
 * this component reflects the `editable` prop onto the editor; nothing else
 * calls setEditable.
 */
import { useLayoutEffect, useRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import type { LexicalEditor } from 'lexical'

/** Host props: the editor binding plus the div passthroughs the bar owns. */
export interface ComposerContentEditableProps extends HTMLAttributes<HTMLDivElement> {
  /** The shell-owned editor; null renders the same div unbound and inert. */
  readonly editor: LexicalEditor | null
  /** Whether the user may edit (readOnly/disabled states fold in here). */
  readonly editable: boolean
  /** Plain text displayed before an editor-backed Session exists. */
  readonly standaloneText?: string | undefined
  /** Notify the owner about edits to the pre-Session text. */
  readonly onStandaloneInput?: ((text: string) => void) | undefined
}

/**
 * Render the composer's editable surface.
 * @param props - editor binding, editability, and div passthroughs.
 * @returns the resident contenteditable div.
 */
export function ComposerContentEditable({
  editor, editable, standaloneText, onStandaloneInput, ...rest
}: ComposerContentEditableProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (editor === null && el !== null && standaloneText !== undefined && el.textContent !== standaloneText) {
      el.textContent = standaloneText
    }
  }, [editor, standaloneText])
  useLayoutEffect(() => {
    const el = ref.current
    if (editor === null || el === null) return
    editor.setRootElement(el)
    return () => { editor.setRootElement(null) }
  }, [editor])
  useLayoutEffect(() => {
    if (editor !== null) editor.setEditable(editable)
  }, [editor, editable])
  return (
    <div
      ref={ref}
      // Lexical's setRootElement never touches contenteditable; the binding
      // renders it, and setEditable above keeps the editor's own gate in step.
      contentEditable={editable}
      onInput={editor === null && onStandaloneInput !== undefined
        ? (event) => { onStandaloneInput(event.currentTarget.textContent ?? '') }
        : undefined}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-composer-input
      {...rest}
    />
  )
}
