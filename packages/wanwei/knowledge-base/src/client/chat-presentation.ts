/** Project logged knowledge originals into the public turn Markdown presentation. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AssistantMarkdownPresentation } from '@deepseek-ai/dsh-client-ui-chat/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { knowledgeSources } from './chat-sources.ts'

/** Build a product-owned citation contribution.
 * @param open - Open a validated original path and its document name.
 * @returns Turn presentation definition for knowledge retrieval notices.
 */
export function chatSourceDefinition(open: (original: string, name: string) => void): ConversationNodeDefinition<null> {
  return {
    kind: 'assistant-markdown',
    match: event => event.type === 'user/message' && isAppendSurfaceEvent(event)
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'wanwei-knowledge-retrieval'
      ? { id: String(event.data.id), role: 'start' } : null,
    start: () => null,
    update: () => null,
    buildLocationData: (context, scope) => {
      const match = context.start
      if (scope !== 'turn' || match?.event.type !== 'user/message') return null
      const { event, location } = match
      if (location.kind !== 'turn' && location.kind !== 'step') return null
      const first = event.data.content[0]
      const sources = first?.type === 'text' ? knowledgeSources(first.text) : null
      if (sources === null) return null
      const byName = new Map<string, string | undefined>()
      const byPath = new Map<string, string>()
      for (const source of sources) {
        byName.set(source.document, byName.has(source.document)
          && byName.get(source.document) !== source.original ? undefined : source.original)
        if (source.original !== undefined) byPath.set(source.original, source.document)
      }
      const value: AssistantMarkdownPresentation = {
        transformText: text => text.replace(/(?<![\[\x60])《([^《》\r\n]+)》(?![\]\x60])/g, (label, name: string) => {
          const original = byName.get(name)
          return original === undefined || /[\[\]\\]/.test(label) ? label : `[${label}](${original})`
        }),
        fileMentions: {
          resolve: (original) => {
            const name = byPath.get(original)
            return name === undefined ? undefined : { label: name, title: name, open: () => open(original, name) }
          },
        },
      }
      return { kind: 'turn', turn: location.turn.turn, key: 'assistant-markdown', value }
    },
  }
}
