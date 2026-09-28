import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** Operations an embedding product shell may provide to browser plugins. */
export interface ClientPlatformActionProvider {
  /** Open one host directory in the operating system's file manager. */
  openDirectory?: (path: string) => Promise<void>
  /** Save bytes through a native product shell. */
  saveFile?: (input: { filename: string; bytes: Uint8Array }) => Promise<void | { path: string; warning?: string }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformActions: ClientPlatformActions
  }
}

/** Registry for optional operations owned by an embedding product shell. */
export class ClientPlatformActions extends Service {
  private provider: ClientPlatformActionProvider | undefined

  /** @param ctx - client root context that owns the registry. */
  constructor(ctx: Context) {
    super(ctx, 'platformActions')
  }

  /**
   * Install the product shell provider.
   * @param provider - operations implemented outside the official browser application.
   * @returns disposer that removes this exact provider.
   */
  register(provider: ClientPlatformActionProvider): () => void {
    if (this.provider !== undefined) throw new Error('client platform actions already have a provider')
    this.provider = provider
    return () => {
      if (this.provider === provider) this.provider = undefined
    }
  }

  /** Report directory-opening availability.
 * @returns Whether a provider is registered.
 */
  canOpenDirectory(): boolean {
    return this.provider?.openDirectory !== undefined
  }

  /** Open a directory, rejecting if unavailable.
 * @param path - Absolute host directory.
 */
  async openDirectory(path: string): Promise<void> {
    const action = this.provider?.openDirectory
    if (action === undefined) throw new Error('directory opening is unavailable in this application')
    await action(path)
  }

  /** Report native file-saving availability.
 * @returns Whether a provider is registered.
 */
  canSaveFile(): boolean {
    return this.provider?.saveFile !== undefined
  }

  /** Save bytes, rejecting if unavailable.
 * @param input - Filename and bytes passed to the shell.
 * @returns After persistence completes, an optional saved path and non-fatal follow-up warning.
 */
  async saveFile(input: { filename: string; bytes: Uint8Array }): Promise<void | { path: string; warning?: string }> {
    const action = this.provider?.saveFile
    if (action === undefined) throw new Error('native file saving is unavailable in this application')
    return action(input)
  }
}

/** Provide the optional client platform-operation registry. */
export function apply(ctx: Context): void {
  ctx.plugin(ClientPlatformActions)
}
