// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { DraftPermission } from '../src/client/skeleton/DraftPermission.tsx'

afterEach(cleanup)
it('uses deployment-owned permissions before Workspace selection', async () => {
  const choose = vi.fn()
  const load = vi.fn(async () => ({ currentValue: 'read-only', options: [
    { value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'workspace-write' },
  ] }))
  const t = (key: string, values?: Record<string, string>) => key === 'input.accessMode' ? `Access ${values?.name}` : key
  const useSubmission = (select: (value: { busy: boolean }) => unknown) => select({ busy: false })
  render(<DraftPermission {...{ sessionId: undefined, load, choose, t, useSubmission } as ComponentProps<typeof DraftPermission>} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Access Read Only' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Workspace Write' }))
  expect(choose).toHaveBeenCalledWith('workspace-write')
})
