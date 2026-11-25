import { expect, it, vi } from 'vitest'
import { chatSourceDefinition } from '../src/client/chat-presentation.ts'

it('resolves only retrieved files and preserves ordinary answer text', () => {
  const open = vi.fn()
  const original = '/api/desktop-knowledge-file?id=3&documentId=policy'
  const definition = chatSourceDefinition(open)
  const event = {
    type: 'user/message', seq: 3, surfaceOp: 'append',
    data: { id: 'retrieval', source: { kind: 'plugin', plugin: 'wanwei-knowledge-retrieval' },
      content: [{ type: 'text', text: `参考片段\n\n${JSON.stringify([
        { document: '制度.pdf', original, excerpt: '正文' },
        { document: '非法.pdf', original: 'javascript:alert(1)', excerpt: '正文' },
      ])}` }] },
  }
  expect(definition.match(event as never)).toEqual({ id: 'retrieval', role: 'start' })
  const context = { start: { event, location: { kind: 'step', turn: { turn: 1 } } } }
  const data = definition.buildLocationData?.(context as never, 'turn')
  const value = data?.value as {
    transformText(text: string): string
    fileMentions: { resolve(path: string): { open(): void } | undefined }
  }
  expect(value.transformText('见《制度.pdf》和《其它.pdf》。'))
    .toBe(`见[《制度.pdf》](${original})和《其它.pdf》。`)
  value.fileMentions.resolve(original)?.open()
  expect(open).toHaveBeenCalledWith(original, '制度.pdf')
  expect(value.fileMentions.resolve('javascript:alert(1)')).toBeUndefined()
  expect(value.fileMentions.resolve('/api/desktop-knowledge-file?id=4&documentId=other')).toBeUndefined()
  expect(definition.match({ ...event, data: { ...event.data, source: { kind: 'user' } } } as never)).toBeNull()
})
