// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { FileImportAction } from '../src/client/product.tsx'

const desktopWindow = window as Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, args?: unknown) => Promise<unknown> }
afterEach(() => { cleanup(); vi.useRealTimers(); delete desktopWindow.__ZJUGIS_NATIVE_INVOKE__ })

function bench(inCard = false) {
  const appendReferences = vi.fn(() => true)
  const setDraft = vi.fn()
  const invoke = vi.fn(async () => ['3 (1).txt'])
  desktopWindow.__ZJUGIS_NATIVE_INVOKE__ = invoke
  const props = {
    sessionId: 'session',
    useWorkspaces: (select: (state: unknown) => unknown) => select({ items: [{ path: 'workspace', sessionIds: ['session'] }] }),
    inputActions: { appendReferences, setDraft },
  } as unknown as ComponentProps<typeof FileImportAction>
  return { ...render(inCard ? <div data-composer-card><FileImportAction {...props} /></div>
    : <FileImportAction {...props} />), appendReferences, setDraft, invoke }
}

describe('desktop file import', () => {
  it('dismisses completion after three seconds and preserves progress for a slow subsequent import', async () => {
    vi.useFakeTimers()
    const view = bench()
    await act(async () => { fireEvent(window, new Event('dsh:native-file-drop')) })
    expect(view.getByRole('status').textContent).toBe('已导入 1 个文件')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(view.queryByRole('status')).toBeNull()
    let finish: (paths: string[]) => void = () => {}
    view.invoke.mockImplementationOnce(() => new Promise<string[]>((resolve) => { finish = resolve }))
    await act(async () => { fireEvent(window, new Event('dsh:native-file-drop')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(view.getByRole('status').textContent).toBe('正在导入文件…')
    await act(async () => { finish(['another.txt']) })
    expect(view.getByRole('status').textContent).toBe('已导入 1 个文件')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(view.queryByRole('status')).toBeNull()
  })
  it('dismisses an import failure after allowing time to read it', async () => {
    vi.useFakeTimers()
    const view = bench()
    view.invoke.mockRejectedValueOnce(new Error('无法复制文件'))
    await act(async () => { fireEvent(window, new Event('dsh:native-file-drop')) })
    expect(view.getByRole('alert').textContent).toContain('无法复制文件')
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(view.queryByRole('alert')).toBeNull()
  })
  it('anchors the drag invitation to the composer card and clears it on leave', () => {
    const view = bench(true)
    fireEvent(window, new Event('dsh:native-file-drag-enter'))
    const overlay = view.getByRole('status')
    expect(overlay.closest('[data-composer-card]')).toBe(view.container.firstElementChild)
    expect(overlay.parentElement).toBe(view.container.firstElementChild)
    fireEvent(window, new Event('dsh:native-file-drag-leave'))
    expect(view.queryByRole('status')).toBeNull()
  })
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
