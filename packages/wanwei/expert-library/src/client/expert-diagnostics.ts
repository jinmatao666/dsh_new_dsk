/** Emit content-free checkpoints; the desktop shell owns collection and limits.
 * @param action - Fixed lifecycle checkpoint, never expert names, URLs or errors.
 */
export function traceExpertAction(action: 'library-open' | 'detail-open' | 'cancel-handler' | 'start-handler'
  | 'start-enter' | 'start-ignored' | 'request-start' | 'request-success' | 'prepare-start' | 'prepare-done'
  | 'launch-mounted' | 'launch-error'): void {
  window.dispatchEvent(new CustomEvent('wanwei:expert-action', { detail: action }))
}
