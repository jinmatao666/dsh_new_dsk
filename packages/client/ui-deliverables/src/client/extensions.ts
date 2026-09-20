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

  /** @param detector - product artifact parser. @returns disposer for this parser. */
  registerDetector(detector: RuntimeDeliverableDetector): () => void {
    this.detectors.push(detector)
    return () => {
      const index = this.detectors.indexOf(detector)
      if (index >= 0) this.detectors.splice(index, 1)
    }
  }

  /** @param text - textual tool result. @returns contributed artifact paths. */
  detect(text: string): readonly string[] {
    return [...new Set(this.detectors.flatMap(detector => [...detector(text)]))]
  }

  /** @param presenter - product artifact presenter. @returns disposer for this presenter. */
  registerPresenter(presenter: DeliverablePresenter): () => void {
    this.presenters.push(presenter)
    return () => {
      const index = this.presenters.indexOf(presenter)
      if (index >= 0) this.presenters.splice(index, 1)
    }
  }

  /** @param path - artifact path. @returns whether a product presenter owns its ordinary chip. */
  isClaimed(path: string): boolean {
    return this.presenters.some(presenter => presenter.claims(path))
  }

  /** @returns product result nodes for this turn. */
  render(paths: readonly string[], openFile: (path: string) => void): readonly ReactNode[] {
    return this.presenters.map(presenter => presenter.render(paths, openFile))
  }
}
