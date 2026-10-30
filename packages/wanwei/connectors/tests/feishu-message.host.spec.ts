import { expect, it } from 'vitest'
import { feishuParts, feishuPost, formatFeishuArgs } from '../src/feishu-message.ts'

it('uses native Markdown rendering without inventing a title or dropping meaningful symbols', () => {
  const text = '# 书单\n\n1. **百年孤独**\n\n| 名称 | 说明 |\n| --- | --- |\n| A | B |\n\n[链接](https://example.com)\n\n```python\na = 2 ** 3\n```\nC:\\data\\a_b.txt，$x+y$'
  expect(JSON.parse(feishuPost(text))).toEqual({ zh_cn: { title: '', content: [[{ tag: 'md', text }]] } })
})
it('converts ordinary inline sends and replies but leaves explicit rich content and file references alone', () => {
  for (const op of ['+messages-send', '+messages-reply']) {
    const args = ['im', op, '--as', 'user', '--user-id', 'ou_owner', '--text', '**正文**']
    const value = formatFeishuArgs(args)
    expect(value).toContain('ou_owner')
    expect(value[value.indexOf('--msg-type') + 1]).toBe('post')
    expect(value[value.indexOf('--content') + 1]).toBe(feishuPost('**正文**'))
    expect(args).toContain('--text')
  }
  const rich = ['im', '+messages-send', '--msg-type', 'interactive', '--content', '{}']
  expect(formatFeishuArgs(rich)).toBe(rich)
  const file = ['im', '+messages-send', '--text', '@file.md']
  expect(formatFeishuArgs(file)).toBe(file)
  const literal = ['im', '+messages-send', '--msg-type', 'text', '--content', JSON.stringify({ text: '@literal.txt' })]
  expect(formatFeishuArgs(literal)).toContain(feishuPost('@literal.txt'))
  const invalid = ['im', '+messages-send', '--content', 'not json']
  expect(formatFeishuArgs(invalid)).toBe(invalid)
})
it('preserves every Unicode character and prefers paragraph boundaries', () => {
  const text = ('说明🙂'.repeat(400) + '\n\n').repeat(8)
  const parts = feishuParts(text)
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.join('')).toBe(text)
  expect(parts.every(part => Array.from(part).length <= 3000)).toBe(true)
})
it('repairs code fences across parts without dropping code', () => {
  const parts = feishuParts('```python\n' + 'print(1)\n'.repeat(900) + '```')
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.every(part => part.startsWith('```') && part.endsWith('```'))).toBe(true)
  expect(parts.join('').match(/print\(1\)/g)).toHaveLength(900)
})
