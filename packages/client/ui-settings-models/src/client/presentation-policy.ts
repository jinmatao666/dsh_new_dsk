import type {} from '@deepseek-ai/cordis'

/** Product-owned presentation of server-managed and user-configured model routes. */
export interface ModelSettingsPolicy {
  /** Provider controlled by the connected server, never edited in this page. */
  readonly managedProvider: string
  /** Restrict local additions to custom endpoints with generated route identifiers. */
  readonly customOnly: boolean
  /** Suppress the upstream welcome notice for products with their own onboarding. */
  readonly skipOnboarding?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional product policy installed before the model settings and picker render. */
    modelSettingsPolicy?: ModelSettingsPolicy
  }
}
