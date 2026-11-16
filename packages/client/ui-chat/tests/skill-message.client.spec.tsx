// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'

it('uses the current turn skill injection label in the sent message', () => {
  const snapshot = { locations: { getTurn: () => ['injection'] }, nodes: { get: () => ({ kind: 'context',
    data: { source: { kind: 'skill-invocation', name: 'pvs-contract-template', displayName: '规划合同起草' } } }) } }
  const props = { node: { location: { kind: 'turn', turn: { turn: 1 } },
    data: { time: 100, content: [{ type: 'text', text: '/pvs-contract-template 帮我起草' }] } },
  useChat: (select: (value: typeof snapshot) => unknown) => select(snapshot),
  renderMessageImages: () => null, t: (key: string) => key,
  } as unknown as Parameters<typeof UserMessageNodeView>[0]
  const { container } = render(<UserMessageNodeView {...props} />)
  expect(container.querySelector('[data-ref-chip="skill"]')?.textContent).toBe('规划合同起草')
  expect(container.textContent).not.toContain('/pvs-contract-template')
})
