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

function composer(view: ReturnType<typeof bench>) {
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  view.container.querySelector('[data-composer-card]')!.append(editable)
  return editable
}

function clipboardPaste(target: HTMLElement, files: File[], text = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files, items: files.map(file => ({ kind: 'file', getAsFile: () => file })),
    getData: (format: string) => format === 'text/plain' ? text : '',
  } })
  fireEvent(target, event)
  return event
}

describe('desktop file import', () => {
  it.each(['report.doc', 'report.docx', 'report.pdf', 'report.xls', 'report.xlsx'])
  ('imports copied %s through the same file/reference route as dropping', async (name) => {
    const view = bench(true)
    const file = new File(['document'], name, { type: 'application/octet-stream' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
    const event = clipboardPaste(composer(view), [file])
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => { expect(view.invoke).toHaveBeenCalledWith('import_workspace_files', {
      workspacePath: 'workspace', files: [{ name, bytes: [0, 0, 0, 0] }],
    }) })
    await waitFor(() => { expect(view.appendReferences).toHaveBeenCalledTimes(1) })
    expect(view.setDraft).not.toHaveBeenCalled()
  })

  it('relays images and text from mixed pastes without sending documents into image validation', async () => {
    const view = bench(true)
    const editor = composer(view)
    const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(3) })
    const image = new File(['png'], 'shot.png', { type: 'image/png' })
    const receive = vi.fn((event: Event) => {
      const data = (event as ClipboardEvent).clipboardData!
      expect(Array.from(data.files)).toEqual([image])
      expect(data.getData('text/plain')).toBe('请整理资料')
    })
    editor.addEventListener('paste', receive)
    clipboardPaste(editor, [file, image], '请整理资料')
    expect(receive).toHaveBeenCalledOnce()
    await waitFor(() => { expect(view.appendReferences).toHaveBeenCalledOnce() })
    expect(view.invoke).toHaveBeenCalledOnce()
  })

  it('preserves ordinary text, screenshots and paste in other fields', async () => {
    const view = bench(true)
    const editor = composer(view)
    const text = clipboardPaste(editor, [], '正常文字')
    expect(text.defaultPrevented).toBe(false)
    const image = clipboardPaste(editor, [new File(['png'], 'shot.png', { type: 'image/png' })])
    expect(image.defaultPrevented).toBe(false)
    const other = document.createElement('div')
    other.setAttribute('contenteditable', 'true')
    document.body.append(other)
    try {
      expect(clipboardPaste(other, [new File(['pdf'], 'other.pdf')]).defaultPrevented).toBe(false)
      fireEvent.keyDown(other, { key: 'v', ctrlKey: true })
      await new Promise(resolve => window.setTimeout(resolve, 5))
      expect(view.invoke).not.toHaveBeenCalled()
    } finally { other.remove() }
  })

  it('uses native clipboard files when the OS exposes no DOM paste payload, without duplicating DOM imports', async () => {
    const view = bench(true)
    const editor = composer(view)
    editor.focus()
    fireEvent.keyDown(editor, { key: 'v', ctrlKey: true })
    clipboardPaste(editor, [])
    await waitFor(() => { expect(view.invoke).toHaveBeenCalledWith('import_clipboard_workspace_files', {
      workspacePath: 'workspace',
    }) })
    await waitFor(() => { expect(view.appendReferences).toHaveBeenCalledOnce() })
    await new Promise(resolve => window.setTimeout(resolve, 5))
    expect(view.invoke).toHaveBeenCalledOnce()
  })

  it('supports OS file paste when no paste event is dispatched', async () => {
    const view = bench(true)
    const editor = composer(view)
    editor.focus()
    fireEvent.keyDown(editor, { key: 'v', metaKey: true })
    await waitFor(() => { expect(view.invoke).toHaveBeenCalledWith('import_clipboard_workspace_files', {
      workspacePath: 'workspace',
    }) })
  })

  it('does not import twice when Ctrl+V also supplies DOM files, and ignores an empty native file list', async () => {
    const view = bench(true)
    const editor = composer(view)
    editor.focus()
    const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(3) })
    fireEvent.keyDown(editor, { key: 'v', ctrlKey: true })
    clipboardPaste(editor, [file])
    await waitFor(() => { expect(view.appendReferences).toHaveBeenCalledOnce() })
    await new Promise(resolve => window.setTimeout(resolve, 5))
    expect(view.invoke).toHaveBeenCalledOnce()
    view.invoke.mockResolvedValue([])
    clipboardPaste(editor, [])
    await waitFor(() => { expect(view.queryByRole('status')).toBeNull() })
    expect(view.appendReferences).toHaveBeenCalledOnce()
  })

  it('cancels the pending native read on unmount', async () => {
    const view = bench(true)
    const editor = composer(view)
    editor.focus()
    fireEvent.keyDown(editor, { key: 'v', ctrlKey: true })
    view.unmount()
    await new Promise(resolve => window.setTimeout(resolve, 5))
    expect(view.invoke).not.toHaveBeenCalled()
  })

  it('keeps failed imports visible and does not insert a file reference', async () => {
    const view = bench(true)
    view.invoke.mockRejectedValue(new Error('文件不可读取'))
    clipboardPaste(composer(view), [])
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('文件不可读取') })
    expect(view.appendReferences).not.toHaveBeenCalled()
  })
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
