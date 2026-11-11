/** Browser-safe authentication state shared by both plugin halves. */
export type AuthState =
  | { state: 'authenticated'; models: string[]; username?: string; passwordSetup?: boolean }
  | { state: 'logged-out'; username?: string }
  | { state: 'offline'; message: string }

/** Browser-safe account identity with separately masked bound-phone details. */
export interface AccountSecurity { userId?: string; username: string; phoneBound: boolean; phone: string; wechatBound: boolean }
