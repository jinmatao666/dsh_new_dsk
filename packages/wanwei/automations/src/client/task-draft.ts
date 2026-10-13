/** Open a fresh conversation draft without sending or saving a scheduled task. */
import { productText } from './locales/product.ts'

/** Stage the task-creation prefix, clear the selected conversation and close the page.
 * @param input - Generic pre-Session draft control.
 * @param sessions - Generic Session navigation.
 * @param close - Automation page close callback.
 */
export function startAutomationConversation(input: { setStagedDraft(text: string): void },
  sessions: { clear(): void }, close: () => void): void {
  input.setStagedDraft(productText('帮我创建一个定时任务：'))
  sessions.clear()
  close()
}
