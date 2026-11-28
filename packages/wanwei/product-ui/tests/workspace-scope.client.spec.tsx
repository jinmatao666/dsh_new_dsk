// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { FileImportAction } from '../src/client/product.tsx'

const native = window as Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, input?: unknown) => Promise<unknown> }
afterEach(() => { cleanup(); delete native.__ZJUGIS_NATIVE_INVOKE__ })

describe('workspace files follow the selected session', () => {
  it('never selects the first workspace when no session is selected', () => {
    const invoke = vi.fn(async () => [])
    native.__ZJUGIS_NATIVE_INVOKE__ = invoke
    const props = {
      useWorkspaces: (select: (value: unknown) => unknown) => select({ items: [{ path: '/one', sessionIds: ['one'] }, { path: '/two', sessionIds: ['two'] }] }),
      inputActions: { appendReferences: vi.fn() },
    } as unknown as ComponentProps<typeof FileImportAction>
    const view = render(<FileImportAction {...props} />)
    expect(view.queryByRole('button', { name: '工作区文件' })).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
  it('switches the file root with the selected session and hides it on an unbound screen', async () => {
    const invoke = vi.fn(async () => [])
    native.__ZJUGIS_NATIVE_INVOKE__ = invoke
    const props = {
      sessionId: 'one',
      useWorkspaces: (select: (value: unknown) => unknown) => select({ items: [{ path: '/one', sessionIds: ['one'] }, { path: '/two', sessionIds: ['two'] }] }),
      inputActions: { appendReferences: vi.fn() },
    } as unknown as ComponentProps<typeof FileImportAction>
    const view = render(<FileImportAction {...props} />)
    await waitFor(() =>{  expect(invoke).toHaveBeenCalledWith('list_workspace_preview', { root: '/one', parts: [] }) })
    invoke.mockClear()
    view.rerender(<FileImportAction {...props} sessionId={'two' as typeof props.sessionId} />)
    await waitFor(() =>{  expect(invoke).toHaveBeenCalledWith('list_workspace_preview', { root: '/two', parts: [] }) })
    expect(invoke).not.toHaveBeenCalledWith('list_workspace_preview', { root: '/one', parts: [] })
    view.rerender(<FileImportAction {...props} sessionId={undefined} />)
    expect(view.queryByRole('complementary', { name: '工作区文件' })).toBeNull()
  })
})
