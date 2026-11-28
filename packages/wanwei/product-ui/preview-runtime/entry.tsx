/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { render } from 'solid-js/web'
import { createSignal, Match, Switch } from 'solid-js'
import { OfficePreview } from './office-preview'
import { ImagePreview } from './image-preview'
import { MarkdownPreview } from './markdown-preview'
import { HtmlPreview } from './html-preview'
import type { PreviewTextSelection } from './preview-edit'

type Input = { content: string; name: string; mime: string; text?: string; version: string }
const [input, setInput] = createSignal<Input>()
const sendSelection = (selection: PreviewTextSelection | undefined) => parent.postMessage({ type: 'buddy-preview-selection', selection }, '*')
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'buddy-preview-content') return
  setInput(event.data.input)
})
window.addEventListener('error', event => parent.postMessage({ type: 'buddy-preview-error', message: event.message }, '*'))
render(() => <Switch>
  <Match when={input()}>{value => <Switch>
    <Match when={value().mime.startsWith('image/')}><ImagePreview src={'data:' + value().mime + ';base64,' + value().content} path={value().name} /></Match>
    <Match when={value().mime === 'text/markdown'}><MarkdownPreview content={value().text ?? ''} onSelectionChange={sendSelection} onSelectionContextMenu={selection => { sendSelection(selection); return false }} /></Match>
    <Match when={value().mime === 'text/html'}><HtmlPreview content={value().text ?? ''} /></Match>
    <Match when={value().mime === 'text/plain'}><pre class="h-full overflow-auto p-4 whitespace-pre-wrap font-mono text-[13px] leading-6" onMouseUp={() => {
      const selectedText = window.getSelection()?.toString()
      sendSelection(selectedText ? { selectedText, contextBefore: '', contextAfter: '', menu: { x: 0, y: 0 } } : undefined)
    }}>{value().text}</pre></Match>
    <Match when={value().mime.startsWith('application/')}><OfficePreview content={{ content: value().content, mimeType: value().mime }} path={value().name} version={value().version} onSelectionChange={sendSelection} onSelectionContextMenu={selection => { sendSelection(selection); return false }} /></Match>
  </Switch>}</Match>
</Switch>, document.getElementById('root')!)
parent.postMessage({ type: 'buddy-preview-ready' }, '*')
