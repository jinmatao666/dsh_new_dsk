/** Feishu-native rich text shared by task replies and scheduled deliveries. */

/** Encode Markdown as a native post, without adding a heading or delivery labels.
 * @param text - User-visible message body; serialized as data, never CLI options.
 * @returns JSON content for Feishu's post message type.
 */
export function feishuPost(text: string): string {
  return JSON.stringify({ zh_cn: { title: '', content: [[{ tag: 'md', text }]] } })
}

/** Split long output at paragraphs or lines where possible; preserve Unicode and fenced code.
 * @param text - Complete output.
 * @returns Ordered Markdown parts, each bounded to 3000 code points including fence repair.
 */
export function feishuParts(text: string): string[] {
  const points = Array.from(text)
  const parts: string[] = []
  let fence = ''
  for (let offset = 0; offset < points.length;) {
    let end = Math.min(points.length, offset + 2800)
    if (end < points.length) {
      const candidate = points.slice(offset, end).join('')
      const boundary = Math.max(candidate.lastIndexOf('\n\n'), candidate.lastIndexOf('\n'))
      if (boundary > candidate.length / 2) end = offset + Array.from(candidate.slice(0, boundary + 1)).length
    }
    const body = points.slice(offset, end).join('')
    const prefix = fence ? fence + '\n' : ''
    for (const line of body.split('\n')) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) fence = fence ? '' : marker
    }
    parts.push(prefix + body + (fence ? '\n' + fence : ''))
    offset = end
  }
  return parts
}

/** Adapt inline text sends only; preserve explicit rich messages, recipients and file references.
 * @param args - Native lark-cli arguments.
 * @returns Arguments using post Markdown for valid inline text sends/replies.
 */
export function formatFeishuArgs(args: readonly string[]): readonly string[] {
  if (args[0] !== 'im' || !['+messages-send', '+messages-reply'].includes(args[1] ?? '')) return args
  const type = args.indexOf('--msg-type')
  if (type >= 0 && args[type + 1] !== 'text') return args
  const content = args.indexOf('--content')
  const plain = args.indexOf('--text')
  let text: string | undefined
  if (content >= 0) {
    try {
      const value: unknown = JSON.parse(args[content + 1] ?? '')
      if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') text = value.text
    } catch { return args }
  } else if (plain >= 0 && !args[plain + 1]?.startsWith('@') && args[plain + 1] !== '-') text = args[plain + 1]
  if (text === undefined) return args
  const output = [...args]
  if (content >= 0) output[content + 1] = feishuPost(text)
  else output.splice(plain, 2, '--content', feishuPost(text))
  if (type >= 0) output[output.indexOf('--msg-type') + 1] = 'post'
  else output.push('--msg-type', 'post')
  return output
}
