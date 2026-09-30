/** Collect durable skill-use events without inspecting prompts beyond skill tokens. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

interface SkillUsage {
  event_id: string
  item_id: string
  item_name: string
  invocation_type: 'user_explicit' | 'model_auto'
}

function eventId(session: Session, event: SessionEvent, name: string): string {
  return createHash('sha256').update(`${session.id}\0${event.seq}\0${name}`).digest('hex')
}

/** Count only skill references resolved by the official skill injector. */
export function skillUsages(session: Session, event: SessionEvent): SkillUsage[] {
  if (event.type === 'user/message') {
    const source = event.data.source as { kind: string; name?: unknown }
    if (source.kind !== 'skill-invocation' || typeof source.name !== 'string') return []
    const name = source.name
    return [{ event_id: eventId(session, event, name), item_id: name,
      item_name: name, invocation_type: 'user_explicit' }]
  }
  if (event.type !== 'tool/call' || event.data.name !== 'skill') return []
  let args: unknown
  try { args = JSON.parse(event.data.arguments) as unknown } catch { return [] }
  const name = (args as { name?: unknown } | null)?.name
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return []
  return [{ event_id: eventId(session, event, name), item_id: name,
    item_name: name, invocation_type: 'model_auto' }]
}

/** Deliver events with stable IDs so server retries cannot create duplicates. */
export function registerSkillUsage(ctx: Context, baseURL: string, resolveToken: () => Promise<string | undefined>): void {
  // Bind each event to the credential active when it occurred. A later login
  // must never attribute an earlier user's event to the new account.
  const pending = new Map<string, { usage: SkillUsage; token: string }>()
  let busy = false
  const flush = async (): Promise<void> => {
    if (busy || pending.size === 0) return
    busy = true
    try {
      for (const [id, { usage, token }] of pending) {
        try {
          const response = await fetch(`${baseURL}/api/usage/skill`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(usage), signal: AbortSignal.timeout(10000),
          })
          if (!response.ok || (await response.json() as { success?: boolean }).success !== true) break
          pending.delete(id)
        } catch { break /* Keep the event for the next delivery attempt. */ }
      }
    } finally { busy = false }
  }
  ctx.on('session/event', (session, event) => {
    const usages = skillUsages(session, event)
    if (usages.length === 0) return
    void resolveToken().then((token) => {
      if (token === undefined) return
      for (const usage of usages) pending.set(usage.event_id, { usage, token })
      void flush()
    }).catch(() => { /* A failed credential lookup must not interrupt the session. */ })
  })
  ctx.effect(() => {
    const timer = setInterval(() => { void flush() }, 20000)
    return () => clearInterval(timer)
  }, 'wanwei-oneapi-auth: skill usage delivery')
}
