// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { FileImportAction } from '../src/client/product.tsx'

const desktopWindow = window as Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, args?: unknown) => Promise<unknown> }
afterEach(() => { cleanup(); delete desktopWindow.__ZJUGIS_NATIVE_INVOKE__ })

function bench() {
  const appendReferences = vi.fn(() => true)
  const setDraft = vi.fn()
  const invoke = vi.fn(async () => ['3 (1).txt'])
  desktopWindow.__ZJUGIS_NATIVE_INVOKE__ = invoke
  const props = {
    sessionId: 'session',
    useWorkspaces: (select: (state: unknown) => unknown) => select({ items: [{ path: 'workspace', sessionIds: ['session'] }] }),
    inputActions: { appendReferences, setDraft },
  } as unknown as ComponentProps<typeof FileImportAction>
  return { ...render(<FileImportAction {...props} />), appendReferences, setDraft, invoke }
}

describe('desktop file import', () => {
  it('uses structured chips for picker imports', async () => {
    const view = bench()
    const file = new File(['text'], '3 (1).txt')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
    fireEvent.change(view.container.querySelector('input')!, { target: { files: [file] } })
    await waitFor(() => { expect(view.appendReferences).toHaveBeenCalledWith([expect.objectContaining({ appearance: 'file', label: '3 (1).txt', ref: '@"3 (1).txt"' })]) })
    expect(view.setDraft).not.toHaveBeenCalled()
  })

  it('uses the same chip path for native drops and permits browser file drops', async () => {
    const view = bench()
    const transfer = { types: ['Files'], dropEffect: 'none' }
    const over = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(over, 'dataTransfer', { value: transfer })
    document.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(transfer.dropEffect).toBe('copy')
    fireEvent(window, new Event('dsh:native-file-drop'))
    await waitFor(() => { expect(view.appendReferences).toHaveBeenCalledTimes(1) })
    expect(view.invoke).toHaveBeenCalledWith('import_dropped_workspace_files', { workspacePath: 'workspace' })
    expect(view.setDraft).not.toHaveBeenCalled()
  })

  it('imports a browser-dropped document without rewriting the draft', async () => {
    const view = bench()
    const file = new File(['text'], '3 (1).txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } })
    fireEvent(document, drop)
    await waitFor(() => { expect(view.appendReferences).toHaveBeenCalledTimes(1) })
    expect(drop.defaultPrevented).toBe(true)
    expect(view.invoke).toHaveBeenCalledWith('import_workspace_files', { workspacePath: 'workspace', files: [{ name: '3 (1).txt', bytes: [0, 0, 0, 0] }] })
    expect(view.setDraft).not.toHaveBeenCalled()
  })
})
