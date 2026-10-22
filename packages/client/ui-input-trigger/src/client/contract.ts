/**
 * Frozen service contract of the slash pipeline. Types only. The
 * InputTriggerService implementation publishes this face as `ctx.inputTriggers`; sources
 * see registerSource alone, the conversation wiring layer resolves its
 * per-session controller through sessionOf.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InputTriggerSource } from '../types.ts'
import type { InputTriggerController } from './controller.ts'
import type { DraftInputTriggers } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The `ctx.inputTriggers` service face. */
export interface InputTriggerServiceContract {
  /**
   * Register one trigger source; duplicate trigger/name pairs throw.
   * @param src - source that discovers and resolves slash or reference candidates.
   * @returns effect disposer removing this source.
   */
  registerSource(src: InputTriggerSource): () => void
  /**
   * Resolve the lazy controller owned by one session scope.
   * @param actx - session-scoped Client context.
   * @returns controller that dies with that scope.
   */
  sessionOf(actx: ClientContext): InputTriggerController
  /**
   * Resolve the root draft menu without allocating a Session or Workspace.
   * @returns The resident controller and its editor binding port.
   */
  draft(): InputTriggerController<undefined> & DraftInputTriggers
}
