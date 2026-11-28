// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { DeliverablePresenter } from '../../../client/ui-deliverables/src/client/extensions.ts'
import { ProducedFiles } from '../../../client/ui-deliverables/src/client/ProducedFiles.tsx'
import { apply } from '../src/client/product.tsx'
import { WorkspaceFiles } from '../src/client/WorkspaceFiles.tsx'

afterEach(cleanup)

describe('collected files and workspace preview coexist', () => {
  it('keeps ordinary files in the original summary instead of claiming them as extra cards', () => {
    const presenters: DeliverablePresenter[] = []
    const services = {
      platformActions: { register: () => () => {} },
      deliverableExtensions: {
        registerDetector: () => () => {},
        registerPresenter: (presenter: DeliverablePresenter) => { presenters.push(presenter); return () => {} },
      },
    }
    apply({ get: (name: keyof typeof services) => services[name], effect: (callback: () => unknown) => callback(),
      inject: () => {}, slots: { inject: () => {} } } as unknown as Context)
    for (const path of ['report.docx', 'data.xlsx', 'preview.png', 'notes.json']) {
      expect(presenters.some(presenter => presenter.claims(path))).toBe(false)
    }
    expect(presenters.some(presenter => presenter.claims('分析视图_20261128_120000_001.json'))).toBe(true)
  })

  it('previews each collected file, keeps system opening in the preview, and falls back outside the workspace', async () => {
    const openFile = vi.fn()
    const setOpen = vi.fn()
    const invoke = vi.fn(async (command: string) => command === 'list_workspace_preview' ? [] : btoa('Preview content'))
    const props = {
      matched: ['E:/collected/one.txt', 'E:/collected/two.json', 'E:/elsewhere/other.txt'], openFile,
      isLoopback: true, ensureWorkspacePathOpen: () => {},
      useWorkspacePathOpen: () => true, t: (key: string) => key,
    } as unknown as ComponentProps<typeof ProducedFiles>
    const view = render(<><ProducedFiles {...props} /><WorkspaceFiles root="E:/collected" invoke={invoke} open={false} setOpen={setOpen} /></>)
    const summary = view.container.querySelector('[data-produced-files-row]')!
    expect(summary.querySelectorAll('button')).toHaveLength(3)
    fireEvent.click(summary.querySelector('[title="E:/collected/one.txt"]')!)
    expect(setOpen).toHaveBeenCalledWith(true)
    expect(openFile).not.toHaveBeenCalled()
    view.rerender(<><ProducedFiles {...props} /><WorkspaceFiles root="E:/collected" invoke={invoke} open setOpen={setOpen} /></>)
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('read_workspace_preview', { root: 'E:/collected', parts: ['one.txt'] }) })
    fireEvent.click(view.getByRole('button', { name: '打开应用' }))
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('open_workspace_preview', { root: 'E:/collected', parts: ['one.txt'] }) })
    fireEvent.click(summary.querySelector('[title="E:/collected/two.json"]')!)
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('read_workspace_preview', { root: 'E:/collected', parts: ['two.json'] }) })
    fireEvent.click(summary.querySelector('[title="E:/elsewhere/other.txt"]')!)
    expect(openFile).toHaveBeenCalledExactlyOnceWith('E:/elsewhere/other.txt')
    expect(view.container.querySelectorAll('[data-produced-files-row] button')).toHaveLength(3)
    expect(document.querySelector('.buddy-workspace-deliverable-card')).toBeNull()
    view.unmount()
  })
})
