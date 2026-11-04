/** Browser-safe authentication state shared by both plugin halves. */
export type AuthState =
  | { state: 'authenticated'; models: string[]; username?: string; passwordSetup?: boolean }
  | { state: 'logged-out'; username?: string }
  | { state: 'offline'; message: string }

/** Public account status excludes credentials and unmasked phone numbers. */
export interface AccountSecurity { phoneBound: boolean; phone: string; wechatBound: boolean }
