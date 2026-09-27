import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'

/** Product-owned parser for additional artifact paths in a tool result. */
export type RuntimeDeliverableDetector = (text: string) => readonly string[]

/** Product-owned visual presentation for selected artifact paths. */
export interface DeliverablePresenter {
  claims: (path: string) => boolean
  render: (paths: readonly string[], openFile: (path: string) => void) => ReactNode
}

declare module '@deepseek-ai/cordis' {
  interface Context { deliverableExtensions: DeliverableExtensions }
}

/** Registry of product parsers layered over the official mutation vocabulary. */
export class DeliverableExtensions extends Service {
  private readonly detectors: RuntimeDeliverableDetector[] = []
  private readonly presenters: DeliverablePresenter[] = []

  /** @param ctx - client root context that owns the registry. */
  constructor(ctx: Context) { super(ctx, 'deliverableExtensions') }

  /** Register an artifact parser.
 * @param detector - Product artifact parser.
 * @returns Parser disposer.
 */
  registerDetector(detector: RuntimeDeliverableDetector): () => void {
    this.detectors.push(detector)
    return () => {
      const index = this.detectors.indexOf(detector)
      if (index >= 0) this.detectors.splice(index, 1)
    }
  }

  /** Collect distinct contributed paths.
 * @param text - Textual tool result.
 * @returns Paths in registration order.
 */
  detect(text: string): readonly string[] {
    return [...new Set(this.detectors.flatMap(detector => [...detector(text)]))]
  }

  /** Register an artifact presenter.
 * @param presenter - Product presenter.
 * @returns Presenter disposer.
 */
  registerPresenter(presenter: DeliverablePresenter): () => void {
    this.presenters.push(presenter)
    return () => {
      const index = this.presenters.indexOf(presenter)
      if (index >= 0) this.presenters.splice(index, 1)
    }
  }

  /** Check whether a presenter replaces the ordinary file chip.
 * @param path - Artifact path.
 * @returns Whether a registered presenter claims the path.
 */
  isClaimed(path: string): boolean {
    return this.presenters.some(presenter => presenter.claims(path))
  }

  /** Render contributions for a turn.
 * @param paths - Produced artifact paths.
 * @param openFile - Caller-owned file opening action.
 * @returns Product result nodes for this turn.
 */
  render(paths: readonly string[], openFile: (path: string) => void): readonly ReactNode[] {
    return this.presenters.map(presenter => presenter.render(paths, openFile))
  }
}
