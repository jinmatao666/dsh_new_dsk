import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ContextMessageNode, SteeringMessageNode, UserMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InboxState } from './inbox.ts'
import { chatNode } from './common.ts'
import { contextForm, contextProvenance } from './event-projection.ts'
import { knowledgeSources } from '../contract/knowledge-sources.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Files retrieved for this turn's knowledge question. */
    'knowledge-sources': NonNullable<ReturnType<typeof knowledgeSources>>
  }
}

interface ReferencedUserMessageNode extends UserMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

interface ReferencedSteeringMessageNode extends SteeringMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

type MessageNode = ReferencedUserMessageNode | ReferencedSteeringMessageNode | ContextMessageNode

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Ordinary turn-opening user message. */
    user: ReferencedUserMessageNode
    /** User message admitted into an active turn. */
    steering: ReferencedSteeringMessageNode
    /** Non-user context injected into model history. */
    context: ContextMessageNode
  }
}

function isCompactionCheckpoint(event: Parameters<ConversationNodeDefinition['match']>[0]): boolean {
  if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) return false
  const source = event.data.source
  return source.kind === 'plugin' && source.plugin === 'compact'
}

/** User, steering, and injected-context message classification Definition. */
export const messageDefinition: ConversationNodeDefinition<MessageNode> = {
  kind: 'input-message',
  target: 'chat',
  match: event => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && !isCompactionCheckpoint(event)
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match, reader) => {
    if (match.event.type !== 'user/message') throw new Error('input-message start requires user/message')
    const event = match.event
    if (event.data.source.kind !== 'user') {
      return {
        kind: 'context',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
        provenance: contextProvenance(event.data.source),
        form: contextForm(event.data.source),
      }
    }
    const claimed = reader.previous<InboxState>('inbox-next-step')?.state.claimed.has(String(event.data.id)) === true
    return claimed
      ? {
        kind: 'steering',
        messageId: event.data.id,
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
      : {
        kind: 'user',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return chatNode(context, context.state.kind, context.state.seq, context.state)
  },
}

/** Publish the source identities of one retrieval notice to its turn. */
export const knowledgeSourcesDefinition: ConversationNodeDefinition<null> = {
  kind: 'knowledge-sources',
  match: event => event.type === 'user/message' && isAppendSurfaceEvent(event)
    && event.data.source.kind === 'plugin' && event.data.source.plugin === 'wanwei-knowledge-retrieval'
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: () => null,
  update: () => null,
  buildLocationData: (context, scope) => {
    const match = context.start
    if (scope !== 'turn' || match?.event.type !== 'user/message') return null
    const { event, location } = match
    if (location.kind !== 'turn' && location.kind !== 'step') return null
    if (event.data.source.kind !== 'plugin' || event.data.source.plugin !== 'wanwei-knowledge-retrieval') return null
    const first = event.data.content[0]
    const value = first?.type === 'text' ? knowledgeSources(first.text) : null
    return value === null ? null : { kind: 'turn', turn: location.turn.turn, key: 'knowledge-sources', value }
  },
}

/**
 * Register the user, steering, and injected-context message contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerMessageConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(messageDefinition)
  ctx.uiConversation.events.register(knowledgeSourcesDefinition)
}
