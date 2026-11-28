/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { createMemo, splitProps } from 'solid-js'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function IconButton(props: Record<string, any>) {
  const [local, rest] = splitProps(props, ['icon', 'variant', 'children'])
  const paths: Record<string, string> = { 'fit-width': 'M3 3v18m18-18v18M8 8l-4 4 4 4m8-8 4 4-4 4M4 12h16', dash: 'M5 12h14', 'plus-small': 'M5 12h14M12 5v14', 'arrow-left': 'm14 6-6 6 6 6', 'arrow-right': 'm10 6 6 6-6 6' }
  return <button {...rest} class="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-background-selected disabled:opacity-40">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d={paths[local.icon] ?? paths['fit-width']} /></svg>
  </button>
}

export function Markdown(props: { children?: string; content?: string; text?: string }) {
  const html = createMemo(() => DOMPurify.sanitize(marked.parse(props.text ?? props.content ?? props.children ?? '', { async: false })))
  return <div data-component="markdown" innerHTML={html()} />
}
