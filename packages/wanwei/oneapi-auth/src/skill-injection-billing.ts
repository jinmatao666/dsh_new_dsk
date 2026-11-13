/** Charge direct skill instructions only when a model begins using that injection. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { createSkillExecutor } from './skill-billing.ts'

/** Install accounting for newly accepted direct skill instructions.
 * @param ctx - Plugin lifetime owning event and stream listeners.
 * @param base - Platform origin.
 * @param resolveToken - Current paying account credential.
 */
export function installSkillInjectionBilling(ctx: Context, base: string,
  resolveToken: () => Promise<string | undefined>): void {
  const executor = createSkillExecutor(ctx, base, resolveToken)
  const turns = new Map<string, { turn: number; attempt: number; loads: Map<string, string> }>()
  ctx.on('session/event', (session, event) => {
    const id = String(session.id)
    if (event.type === 'turn/start') turns.set(id, { turn: event.data.turn, attempt: 0, loads: new Map() })
    if (event.type === 'turn/end') turns.delete(id)
    if (event.type !== 'user/message' || event.data.source.kind !== 'skill-invocation') return
    turns.get(id)?.loads.set(String(event.data.id), event.data.source.name)
  })
  ctx.on('llm/stream', (options, next) => (async function* () {
    const sessionId = String(options.sessionId ?? '')
    const turn = turns.get(sessionId)
    if (!turn || options.turnId !== turn.turn || options.purpose !== undefined) { yield* next(); return }
    const loads = [...turn.loads].filter(([id]) => options.messages.some(message => String(message.id) === id))
    if (loads.length === 0) { yield* next(); return }
    const attempt = ++turn.attempt
    let iterator: AsyncIterator<StreamChunk> | undefined
    const accepted = (first: IteratorResult<StreamChunk>): boolean => !first.done
      && !(first.value.type === 'finish' && (first.value.reason.kind === 'error' || first.value.reason.kind === 'aborted'))
    const enter = async (index: number): Promise<IteratorResult<StreamChunk>> => {
      const load = loads[index]
      if (load === undefined) {
        iterator = next()[Symbol.asyncIterator]()
        return iterator.next()
      }
      const [id, skillName] = load
      const operationId = createHash('sha256').update(JSON.stringify(['injected-skill', sessionId, id, attempt])).digest('hex')
      const result = await executor.run({ operationId, skillName, sessionId, turnId: turn.turn,
        signal: options.signal ?? new AbortController().signal,
        execute: async () => { const first = await enter(index + 1); return { succeeded: accepted(first), value: first } },
      })
      if (result.succeeded) turn.loads.delete(id)
      return result.value
    }
    try {
      let item = await enter(0)
      if (iterator === undefined) return
      while (!item.done) { yield item.value; item = await iterator.next() }
    } finally { await iterator?.return?.() }
  })())
}
