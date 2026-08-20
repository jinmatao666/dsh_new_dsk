/** Browser-safe authentication state shared by both plugin halves. */
export type AuthState =
  | { state: 'authenticated'; models: string[] }
  | { state: 'logged-out' }
  | { state: 'offline'; message: string }
