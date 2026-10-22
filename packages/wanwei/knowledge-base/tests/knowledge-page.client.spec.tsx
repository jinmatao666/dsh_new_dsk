// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgePage, type KnowledgeApi } from '../src/client/KnowledgePage.tsx'

afterEach(cleanup)

it('accepts a 1GB MDB selection and keeps the page usable after an upload error', async () => {
  const service = api()
  const upload = vi.fn(async () => { throw new Error('后台拒绝上传') })
  service.upload = upload
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['MDB'], '基础库.mdb')
  Object.defineProperty(file, 'size', { value: 1024 ** 3 })
  fireEvent.change(input, { target: { files: [file] } })
  expect((await screen.findByRole('alert')).textContent).toContain('后台拒绝上传')
  expect(upload).toHaveBeenCalledWith(1, file)
  expect(screen.getByText('说明.pdf')).toBeTruthy()
  expect(screen.getByRole('button', { name: '上传文档' }).hasAttribute('disabled')).toBe(false)
  expect(screen.getByRole('alert').textContent).toMatchSnapshot()
})

it('rejects a file over 1GB before reading or uploading it', async () => {
  const service = api()
  const upload = vi.fn(async () => {})
  service.upload = upload
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['MDB'], '基础库.mdb')
  Object.defineProperty(file, 'size', { value: 1024 ** 3 + 1 })
  fireEvent.change(input, { target: { files: [file] } })
  expect((await screen.findByRole('alert')).textContent).toContain('文件不能超过 1GB')
  expect(upload).not.toHaveBeenCalled()
})

function api(): KnowledgeApi {
  return {
    list: vi.fn(async () => [
      { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
      { id: 3, name: '团队共享', description: '共享', kind: 'shared' as const, owner_user_id: 7 },
    ]),
    create: vi.fn(async input => ({ id: 2, owner_user_id: 7, ...input })),
    documents: vi.fn(async () => [{ id: 'doc-1', name: '说明.pdf', size: 2048, run: 'DONE', progress: 1 }]),
    chunks: vi.fn(async () => [{ id: 'chunk-1', content: '文档正文内容' }]),
    download: vi.fn(async () => ({ contentType: 'application/pdf', bytes: [37, 80, 68, 70] })),
    upload: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    messages: vi.fn(async () => []),
    complete: vi.fn(async () => ({ answer: '知识库回答', recommendations: ['继续提问'] })),
  }
}

it('loads authorized knowledge bases and creates a shared library', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('说明.pdf')).toBeTruthy()
  expect(screen.getByRole('button', { name: '新建订阅知识库' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '新建订阅知识库' }))
  expect(screen.getByRole('alert').textContent).toContain('暂不支持')
  expect(service.create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '新建共享知识库' }))
  expect(screen.getByRole('dialog', { name: '新建共享知识库' })).toBeTruthy()
  fireEvent.change(screen.getByPlaceholderText('请输入知识库名称'), { target: { value: '协作资料' } })
  fireEvent.click(screen.getByText('确定'))
  await waitFor(() => expect(screen.getAllByText('协作资料')).toHaveLength(2))
  expect(service.create).toHaveBeenCalledWith({ name: '协作资料', description: '', kind: 'shared' })
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  expect(screen.getByRole('menuitem', { name: '本地文件' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '本地文件夹' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '新建文件夹' })).toBeTruthy()
  expect(screen.getByText('PDF')).toBeTruthy()
})

it('uploads every file from a local folder into the selected knowledge base', async () => {
  const service = api()
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const folderInput = container.querySelector('input[webkitdirectory]') as HTMLInputElement
  expect(folderInput).toBeTruthy()
  expect(folderInput.getAttribute('webkitdirectory')).toBe('')
  const nested = new File(['body'], 'nested.md', { type: 'text/markdown' })
  Object.defineProperty(nested, 'webkitRelativePath', { value: '资料/nested.md' })
  const junk = new File([''], '.DS_Store', { type: 'text/plain' })
  Object.defineProperty(junk, 'webkitRelativePath', { value: '资料/.DS_Store' })
  const top = new File(['guide'], '指南.txt', { type: 'text/plain' })
  Object.defineProperty(top, 'webkitRelativePath', { value: '资料/指南.txt' })
  fireEvent.change(folderInput, { target: { files: [nested, junk, top] } })
  await waitFor(() => expect(service.upload).toHaveBeenCalledTimes(2))
  const uploaded = vi.mocked(service.upload).mock.calls.map((call: [number, File]) => ({
    id: call[0],
    name: call[1].name,
  }))
  expect(uploaded).toEqual([{ id: 1, name: 'nested.md' }, { id: 1, name: '指南.txt' }])
  expect(service.documents).toHaveBeenCalled()
})

it('shows uploaded folder paths as expandable folders with nested files', async () => {
  const service = api()
  service.documents = vi.fn(async () => [
    { id: 'doc-1', name: '资料/说明.pdf', location: '资料/说明.pdf', size: 2048, run: 'DONE', progress: 1 },
    { id: 'doc-2', name: '资料/子目录/笔记.md', location: '资料/子目录/笔记.md', size: 128, run: 'DONE', progress: 1 },
    { id: 'doc-3', name: '根目录.txt', size: 32, run: 'DONE', progress: 1 },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByRole('button', { name: /资料/ })).toBeTruthy()
  expect(screen.getByText('说明.pdf')).toBeTruthy()
  expect(screen.getByText('根目录.txt')).toBeTruthy()
  expect(screen.queryByText('笔记.md')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /子目录/ }))
  expect(await screen.findByText('笔记.md')).toBeTruthy()
  expect(screen.getAllByText('文件夹').length).toBeGreaterThan(0)
})

it('drags the divider to change the content width', async () => {
  const { container } = render(<KnowledgePage api={api()} />)
  const section = container.querySelector('.dsh-knowledge') as HTMLElement
  section.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700, toJSON() { return {} },
  })
  const split = await screen.findByRole('separator', { name: '调整内容宽度' })
  fireEvent.pointerDown(split, { button: 0, clientX: 490 })
  fireEvent.pointerMove(window, { clientX: 640 })
  expect(split.getAttribute('aria-valuenow')).toBe('430')
  fireEvent.pointerUp(window)
  fireEvent.keyDown(split, { key: 'ArrowLeft' })
  expect(split.getAttribute('aria-valuenow')).toBe('414')
})

it('restores saved Q&A turns when opening a knowledge base', async () => {
  const service = api()
  service.messages = vi.fn(async () => [
    { role: 'user' as const, content: '上次的问题' },
    { role: 'assistant' as const, content: '上次的回答' },
  ])
  render(<KnowledgePage api={service} />)
  await waitFor(() => expect(service.messages).toHaveBeenCalledWith(1))
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  expect(screen.getByText('上次的回答')).toBeTruthy()
  expect(screen.getByText('万维')).toBeTruthy()
})

it('asks the selected knowledge base through chat completions and renders recommendations', async () => {
  const service = api()
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    onProgress?.({ answer: '知', done: false })
    onProgress?.({ answer: '知识库回答', recommendations: ['继续提问'], done: true })
    return { answer: '知识库回答', recommendations: ['继续提问'] }
  })
  render(<KnowledgePage api={service} />)
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '请概括文档' } })
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('ready')
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(service.complete).toHaveBeenCalled())
  expect(service.complete).toHaveBeenCalledWith(1, '请概括文档', expect.any(Function), expect.any(AbortSignal))
  expect(await screen.findByText('知识库回答')).toBeTruthy()
  expect(screen.getByText('万维')).toBeTruthy()
  expect(screen.getByText('继续提问')).toBeTruthy()
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('idle')
})

it('shows typing dots and a stop control while waiting for the first answer chunk', async () => {
  let finish!: (value: { answer: string; recommendations: string[] }) => void
  const service = api()
  service.complete = vi.fn((_id, _question, onProgress, signal) =>
    new Promise<{ answer: string; recommendations: string[] }>((resolve, reject) => {
      finish = resolve
      signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }, { once: true })
      onProgress?.({ answer: '', done: false })
    }))
  render(<KnowledgePage api={service} />)
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '请概括文档' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByRole('status', { name: '正在回答…' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
  expect(screen.getByText('万维')).toBeTruthy()
  finish({ answer: '知识库回答', recommendations: [] })
  expect(await screen.findByText('知识库回答')).toBeTruthy()
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('idle')
})

it('opens a PDF blob preview when a content list item is double-clicked', async () => {
  const service = api()
  const createObjectURL = vi.fn(() => 'blob:doc')
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  const click = vi.fn()
  const createElement = window.document.createElement.bind(window.document)
  vi.spyOn(window.document, 'createElement').mockImplementation((tagName: string) => {
    const element = createElement(tagName)
    if (tagName === 'a') Object.defineProperty(element, 'click', { value: click })
    return element
  })
  render(<KnowledgePage api={service} />)
  fireEvent.doubleClick(await screen.findByRole('button', { name: /说明\.pdf/ }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'doc-1'))
  expect(service.chunks).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '说明.pdf' })).toBeTruthy()
  expect(screen.getByTitle('说明.pdf')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '下载' }))
  await waitFor(() => expect(service.download).toHaveBeenCalledTimes(2))
  expect(createObjectURL).toHaveBeenCalled()
  expect(click).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog', { name: '说明.pdf' })).toBeNull()
  expect(revokeObjectURL).toHaveBeenCalled()
})

it('previews images through the original file blob', async () => {
  const service = api()
  service.documents = vi.fn(async () => [{ id: 'img-1', name: '截图.png', size: 128, run: 'DONE', progress: 1 }])
  service.download = vi.fn(async () => ({ contentType: 'image/png', bytes: [137, 80, 78, 71] }))
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  render(<KnowledgePage api={service} />)
  fireEvent.doubleClick(await screen.findByRole('button', { name: /截图\.png/ }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'img-1'))
  expect(screen.getByRole('img', { name: '截图.png' })).toBeTruthy()
})

it('selects a document and shows move, copy, and delete actions', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  const row = await screen.findByRole('button', { name: /说明\.pdf/ })
  fireEvent.click(row)
  expect(row.className).toContain('selected')
  expect(screen.getByRole('menuitem', { name: '移动到' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '复制到' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '编辑标签' })).toBeNull()
})

it('moves a selected document into another personal or shared library', async () => {
  const service = api()
  service.documents = vi.fn(async (id: number) => id === 1
    ? [{ id: 'doc-1', name: '说明.pdf', size: 2048, run: 'DONE', progress: 1 }]
    : [])
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '移动到' }))
  const dialog = await screen.findByRole('dialog', { name: /移动/ })
  fireEvent.click(dialog.querySelector('aside button') as HTMLButtonElement)
  fireEvent.click(screen.getByRole('button', { name: '移动至此' }))
  await waitFor(() => expect(service.move).toHaveBeenCalledWith(1, 'doc-1', 3, undefined))
})

it('asks for confirmation before deleting a selected document', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
  const dialog = await screen.findByRole('dialog', { name: '确认删除' })
  expect(dialog.textContent).toContain('说明.pdf')
  expect(service.delete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(service.delete).toHaveBeenCalledWith(1, 'doc-1'))
})
