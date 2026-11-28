// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { WorkspaceFiles } from '../src/client/WorkspaceFiles.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('workspace preview drafts', () => {
  it('preserves a file draft across switching files and saves it against that file original', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const values: Record<string, string> = { 'one.txt': btoa('One original'), 'two.txt': btoa('Two original') }
    const invoke = vi.fn(async (command: string, input: { parts: string[]; content?: string }) => {
      if (command === 'list_workspace_preview') return Object.keys(values).map(name => ({ name, directory: false }))
      if (command === 'read_workspace_preview') return values[input.parts.join('/')]
      if (command === 'save_workspace_preview') { values[input.parts.join('/')] = input.content ?? ''; return }
      throw new Error('Unexpected native command')
    })
    const view = render(<WorkspaceFiles root="draft-test" invoke={invoke} open setOpen={() => {}} />)
    fireEvent.click(await view.findByRole('button', { name: 'one.txt' }))
    fireEvent.click(await view.findByRole('button', { name: '编辑' }))
    fireEvent.change(view.getByLabelText('文件内容'), { target: { value: 'My unsaved edit' } })
    fireEvent.click(view.getByRole('button', { name: 'two.txt' }))
    await waitFor(() => expect(view.queryByLabelText('文件内容')).toBeNull())
    fireEvent.click(await view.findByRole('button', { name: '编辑' }))
    expect((view.getByLabelText('文件内容') as HTMLTextAreaElement).value).toBe('Two original')
    fireEvent.click(view.getByRole('button', { name: 'one.txt' }))
    await waitFor(() => expect((view.getByLabelText('文件内容') as HTMLTextAreaElement).value).toBe('My unsaved edit'))
    fireEvent.click(view.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(values['one.txt']).toBe(btoa('My unsaved edit')))
    expect(values['two.txt']).toBe(btoa('Two original'))
    expect(invoke).toHaveBeenCalledWith('save_workspace_preview', expect.objectContaining({ parts: ['one.txt'], expected: expect.stringMatching(/^[a-f0-9]{64}$/u) }))
  })
})
