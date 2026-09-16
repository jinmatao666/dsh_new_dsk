/** Browser-safe authentication state shared by both plugin halves. */
export type AuthState =
  | { state: 'authenticated'; models: string[]; username?: string }
  | { state: 'logged-out'; username?: string }
  | { state: 'offline'; message: string }
