// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  clearKnowledgeDownloadCache,
  formatAnswerDurationSeconds,
  formatAnswerTiming,
  KnowledgePage,
  relatedQuestions,
  type KnowledgeApi,
} from '../src/client/KnowledgePage.tsx'
import { decodeKnowledgeDocuments } from '../src/client/plugin.tsx'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
  Util: {
    transform: (_viewport: number[], item: number[]) => item,
  },
  getDocument: () => ({
    async destroy() {},
    promise: Promise.resolve({
      numPages: 1,
      async getPage() {
        return {
          getViewport: () => ({ width: 120, height: 160, transform: [1, 0, 0, 1, 0, 0] }),
          render: () => ({ promise: Promise.resolve() }),
          getTextContent: async () => ({ items: [] }),
        }
      },
      async destroy() {},
    }),
  }),
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs', () => ({
  WorkerMessageHandler: { setup() {} },
}))

beforeEach(() => { stubCanvas() })

afterEach(() => {
  clearKnowledgeDownloadCache()
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubCanvas() {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect() {},
    clearRect() {},
    drawImage() {},
    save() {},
    restore() {},
    scale() {},
    translate() {},
    transform() {},
    setTransform() {},
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,AA==')
  HTMLCanvasElement.prototype.toBlob = vi.fn(function toBlob(callback: BlobCallback) {
    callback(new Blob(['x'], { type: 'image/jpeg' }))
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob
}

function api(): KnowledgeApi {
  return {
    creditPrice: vi.fn(async () => ({ enabled: false, applies: false, configured: false, preview_free: false, platform_percent: 30,
      price: { browse_cents: 0, question_cents: 0, download_cents: 0 } })),
    saveCreditPrice: vi.fn(async () => {}),
    list: vi.fn(async () => [
      { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
      { id: 3, name: '团队共享', description: '共享', kind: 'shared' as const, owner_user_id: 7 },
    ]),
    publication: vi.fn(async () => ({ enabled: false, application: null, categories: [] })),
    withdrawPublication: vi.fn(async () => {}),
    applyPublication: vi.fn(async () => { throw new Error('unexpected publication') }),
    categories: vi.fn(async () => []),
    plaza: vi.fn(async () => []),
    plazaItem: vi.fn(async () => {
      throw new Error('missing plaza item')
    }),
    plazaDocuments: vi.fn(async () => []),
    subscribe: vi.fn(async () => {}),
    setLike: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    create: vi.fn(async input => ({ id: 2, owner_user_id: 7, ...input })),
    documents: vi.fn(async () => [{ id: 'doc-1', name: '说明.pdf', size: 2048, run: 'DONE', progress: 1 }]),
    chunks: vi.fn(async () => [{ id: 'chunk-1', content: '文档正文内容' }]),
    download: vi.fn(async () => ({ contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) })),
    folders: vi.fn(async () => []),
    createFolder: vi.fn(async () => {}),
    upload: vi.fn(async () => {}),
    importWebLinks: vi.fn(async () => {}),
    importRecordingMinutes: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    messages: vi.fn(async () => []),
    clearMessages: vi.fn(async () => {}),
    complete: vi.fn(async () => ({ answer: '知识库回答', recommendations: ['继续提问'] })),
  }
}

/** Q&A starts closed; open it from the selected library's sidebar card. */
async function openChat(name = '我的资料') {
  fireEvent.click(await screen.findByRole('button', { name: `打开问答：${name}` }))
}

it('loads authorized knowledge bases and creates a personal library', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('说明.pdf')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '新建订阅知识库' })).toBeNull()
  expect(screen.queryByRole('button', { name: '新建共享知识库' })).toBeNull()
  expect(screen.queryByText('共享知识库')).toBeNull()
  expect(screen.getByRole('button', { name: '展开订阅知识库' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(subscription).getByText('暂无知识库')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '新建个人知识库' }))
  expect(screen.getByRole('dialog', { name: '新建个人知识库' })).toBeTruthy()
  fireEvent.change(screen.getByPlaceholderText('请输入知识库名称'), { target: { value: '协作资料' } })
  fireEvent.change(screen.getByPlaceholderText('多个标签用逗号分隔'), { target: { value: '土地，规划、土地, 测绘' } })
  fireEvent.click(screen.getByText('确定'))
  await waitFor(() => expect(screen.getAllByText('协作资料')).toHaveLength(2))
  expect(service.create).toHaveBeenCalledWith({ name: '协作资料', description: '', kind: 'personal', tags: '土地,规划,测绘' })
  const createdCard = screen.getByRole('button', { name: '协作资料' }).closest('.dsh-knowledge-lib-card') as HTMLElement
  expect([...createdCard.querySelectorAll('.dsh-knowledge-lib-tags > span')].map(tag => tag.textContent)).toEqual(['土地', '规划'])
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  expect(screen.getByRole('menuitem', { name: '本地文件' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '网页链接' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '录音纪要' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '本地文件夹' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '新建文件夹' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '个人知识库' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '笔记' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '腾讯文档' })).toBeNull()
  expect(screen.getByText('PDF', { selector: '.dsh-knowledge-card-status span' })).toBeTruthy()
})

it('shows parse progress while chunking and the file type after a parse failure', async () => {
  const service = api()
  service.documents = vi.fn(async () => [
    {
      id: 'doc-web',
      name: 'MySQL修改connect_timeout (连接超时) 全局变量 - 我找的就是你 - 博客园.html',
      size: 4096,
      run: 'RUNNING',
      progress: 0.03,
      create_time: Date.parse('2026-11-06T09:15:00'),
    },
    {
      id: 'doc-audio',
      name: '录音纪要_261106091257.webm',
      size: 2048,
      run: 'DONE',
      progress: 1,
      create_time: Date.parse('2026-11-06T09:13:00'),
    },
    { id: 'doc-failed', name: '资料.pdf', size: 1024, run: 'FAIL', progress: 0 },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('MySQL修改connect_timeout (连接超时) 全局变量 - 我找的就是你 - 博客园')).toBeTruthy()
  expect(screen.getByText(/解析中…3%/)).toBeTruthy()
  expect(screen.getByText('音频', { exact: true })).toBeTruthy()
  expect(screen.getByText('2026-11-06 09:13')).toBeTruthy()
  expect(screen.getByText('PDF', { selector: '.dsh-knowledge-card-status span' })).toBeTruthy()
  expect(screen.queryByText('解析失败', { exact: true })).toBeNull()
})

it('keeps 网址 kind after stripping the .html display suffix', async () => {
  const service = api()
  service.documents = vi.fn(async () => [
    {
      id: 'doc-web',
      name: 'MySQL修改connect_timeout (连接超时) 全局变量 - 我找的就是你 - 博客园.html',
      size: 4096,
      run: 'DONE',
      progress: 1,
      create_time: Date.parse('2026-11-06T10:38:00'),
    },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('MySQL修改connect_timeout (连接超时) 全局变量 - 我找的就是你 - 博客园')).toBeTruthy()
  expect(screen.getByText('网址', { exact: true })).toBeTruthy()
  expect(screen.getByText('2026-11-06 10:38')).toBeTruthy()
  expect(screen.queryByText(/文件 \|/)).toBeNull()
  const card = screen.getByText('MySQL修改connect_timeout (连接超时) 全局变量 - 我找的就是你 - 博客园')
    .closest('.dsh-knowledge-card') as HTMLElement
  expect(card.className).toContain('web')
  expect(card.querySelector('.dsh-knowledge-document-cover.web')).not.toBeNull()
})

it('imports validated web links into the selected personal library', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '网页链接' }))
  const dialog = screen.getByRole('dialog', { name: '导入网页链接' })
  const input = within(dialog).getByLabelText('网页链接输入')
  fireEvent.change(input, { target: { value: 'not-a-url' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '导入' }))
  expect(within(dialog).getByRole('alert').textContent).toContain('链接格式无效')
  expect(service.importWebLinks).not.toHaveBeenCalled()
  fireEvent.change(input, {
    target: { value: 'https://www.cnblogs.com/wangboyu/p/14463680.html' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '导入' }))
  await waitFor(() => expect(service.importWebLinks).toHaveBeenCalledWith(
    1, ['https://www.cnblogs.com/wangboyu/p/14463680.html'],
  ))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '导入网页链接' })).toBeNull())
})

it('opens the recording panel from the personal upload menu', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '录音纪要' }))
  expect(screen.getByRole('dialog', { name: '录音纪要' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '开始录音' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '取消录音' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '录音纪要' })).toBeNull())
})

it('opens a recording-minutes document in the dual-pane minutes viewer', async () => {
  const service = api()
  const markdown = [
    '# 录音纪要_261106091257',
    '',
    '## 逐字稿',
    '',
    '你好，你好，你好',
    '',
    '## 速览',
    '',
    '00:00 连续问候开场',
    '',
    '## 纪要',
    '',
    '以问候开场，无实质议题。',
    '',
  ].join('\n')
  service.documents = vi.fn(async () => [
    { id: 'audio-1', name: '录音纪要_261106091257.webm', size: 2048, run: 'DONE', progress: 1 },
    { id: 'md-1', name: '录音纪要_261106091257.md', size: markdown.length, run: 'DONE', progress: 1 },
  ])
  service.download = vi.fn(async (_libraryId, documentId) => {
    if (documentId === 'md-1') {
      return {
        contentType: 'text/markdown',
        bytes: new TextEncoder().encode(markdown),
      }
    }
    return {
      contentType: 'audio/webm',
      bytes: new Uint8Array([1, 2, 3, 4]),
    }
  })
  render(<KnowledgePage api={service} />)
  await screen.findByText('录音纪要_261106091257')
  expect(screen.queryByText('录音纪要_261106091257.md')).toBeNull()
  expect(screen.queryByText('录音纪要_261106091257.webm')).toBeNull()
  expect(screen.getByText('音频')).toBeTruthy()
  fireEvent.click(screen.getByText('录音纪要_261106091257'))
  await waitFor(() => expect(screen.getByRole('tab', { name: '速览' })).toBeTruthy())
  expect(screen.getByText('你好，你好，你好')).toBeTruthy()
  expect(screen.getByText('00:00 连续问候开场')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '纪要' }))
  expect(screen.getByText('以问候开场，无实质议题。')).toBeTruthy()
  expect(screen.getByRole('button', { name: '播放' })).toBeTruthy()
  expect((screen.getByRole('button', { name: '问问万维' }) as HTMLButtonElement).disabled).toBe(false)
})

it('hides the upload control for public and subscribed libraries', async () => {
  const service = api()
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    { id: 8, name: '公开法规', description: '公共', kind: 'common' as const, owner_user_id: 1 },
    {
      id: 9, name: '已订法规', description: '订阅', kind: 'common' as const, owner_user_id: 1,
      category_id: 4, subscribed_by_viewer: true,
    },
  ])
  service.categories = vi.fn(async () => [
    { id: 4, name: '授权', type: 'common' as const, require_auth: true },
  ])
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  expect(screen.getByRole('button', { name: '上传文档' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开公共知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '公开法规' }))
  expect(screen.queryByRole('button', { name: '上传文档' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '已订法规' }))
  expect(screen.queryByRole('button', { name: '上传文档' })).toBeNull()
})

it('hides cover upload on the desktop create dialog', async () => {
  render(<KnowledgePage api={api()} />)
  fireEvent.click(await screen.findByRole('button', { name: '新建个人知识库' }))
  expect(screen.getByRole('dialog', { name: '新建个人知识库' })).toBeTruthy()
  expect(screen.queryByLabelText('上传封面')).toBeNull()
  expect(screen.queryByText('封面')).toBeNull()
})

it('paginates the plaza homepage and keeps the pager under the card list', async () => {
  const service = api()
  service.plaza = vi.fn(async () => Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    name: `广场库${String(index).padStart(2, '0')}`,
    description: '描述',
    kind: 'common' as const,
    owner_user_id: 2,
    category_id: 4,
    category_name: '授权',
    owner_username: '维护者',
    subscription_status: 'none' as const,
  })))
  const { container } = render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /知识库广场/ }))
  await screen.findByText('广场库00')
  expect(container.querySelectorAll('.dsh-knowledge-plaza-card')).toHaveLength(10)
  expect(screen.queryByText('广场库10')).toBeNull()
  const plazaPager = screen.getByRole('navigation', { name: '知识库分页' })
  expect(plazaPager.textContent).toContain('第 1 页 / 3')
  fireEvent.click(within(plazaPager).getByRole('button', { name: '下一页' }))
  expect(screen.getByText('广场库10')).toBeTruthy()
  expect(plazaPager.textContent).toContain('第 2 页 / 3')
  const plaza = container.querySelector('.dsh-knowledge-plaza')
  expect(plaza?.contains(container.querySelector('.dsh-knowledge-plaza-pager')!)).toBe(true)
  expect(container.querySelector('.dsh-knowledge-plaza-catalog')?.contains(
    container.querySelector('.dsh-knowledge-plaza-pager')!,
  )).toBe(false)
})

it('keeps the plaza pager visible when the catalog fits on one page', async () => {
  const service = api()
  service.plaza = vi.fn(async () => Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    name: `短目录${index}`,
    description: '描述',
    kind: 'common' as const,
    owner_user_id: 2,
    category_id: 4,
    category_name: '授权',
    owner_username: '维护者',
    subscription_status: 'none' as const,
  })))
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /知识库广场/ }))
  await screen.findByText('短目录0')
  const plazaPager = screen.getByRole('navigation', { name: '知识库分页' })
  expect(plazaPager.textContent).toContain('第 1 页 / 1')
  expect(plazaPager.textContent).toContain('共 6 个')
})

it('shows an uploaded cover on the plaza card and detail', async () => {
  const service = api()
  const cover = 'data:image/jpeg;base64,aaaa'
  const plazaItem = {
    id: 9,
    name: '地方法规知识库',
    description: '地方法规合集',
    kind: 'common' as const,
    owner_user_id: 2,
    category_id: 4,
    category_name: '法律',
    owner_username: '法务平台',
    subscription_status: 'none' as const,
    cover,
  }
  service.plaza = vi.fn(async () => [plazaItem])
  service.plazaItem = vi.fn(async () => plazaItem)
  render(<KnowledgePage api={service} />)
  const plazaLaunch = await screen.findByRole('button', { name: /知识库广场/ })
  expect(plazaLaunch.textContent).toContain('发现优质行业知识')
  expect(plazaLaunch.querySelector('.dsh-knowledge-plaza-launch-bg')?.getAttribute('src'))
    .toBe('/knowledge-covers/plaza-entry.png')
  fireEvent.click(plazaLaunch)
  expect(screen.getByText('知识资源中心，发现并订阅专业知识库，让可靠资料随时参与工作')).toBeTruthy()
  const card = await screen.findByRole('button', { name: /地方法规知识库/ })
  expect(card.querySelector('img')?.getAttribute('src')).toBe(cover)
  fireEvent.click(card)
  expect(await screen.findByRole('button', { name: '订阅' })).toBeTruthy()
  expect(document.querySelector('.dsh-knowledge-plaza-cover.large img')?.getAttribute('src')).toBe(cover)
})

it('selects the first library of the first sidebar group on open', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 3, name: '公开规范', type: 'common' as const, require_auth: false },
  ])
  service.list = vi.fn(async () => [
    { id: 9, name: '公开库甲', description: '公开', kind: 'common' as const, owner_user_id: 2, category_id: 3 },
    { id: 1, name: '我的资料', description: '个人', kind: 'personal' as const, owner_user_id: 7 },
    { id: 2, name: '我的第二库', description: '个人', kind: 'personal' as const, owner_user_id: 7 },
  ])
  service.documents = vi.fn(async (id: number) => [{
    id: `doc-${id}`, name: `库${id}.pdf`, size: 1024, run: 'DONE' as const, progress: 1,
  }])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('库1.pdf')).toBeTruthy()
  const personal = screen.getByText('个人知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(personal).getByText('我的资料').closest('.dsh-knowledge-lib-card')?.className).toContain('active')
  expect(service.documents).toHaveBeenCalledWith(1)
})

it('keeps 个人知识库 to libraries the caller owns even when the list includes another owner', async () => {
  const service = api()
  service.list = vi.fn(async () => [
    {
      id: 1, name: '我的资料', description: '个人', kind: 'personal' as const,
      owner_user_id: 7, owned_by_viewer: true,
    },
    {
      id: 99, name: '他人笔记', description: '不应出现', kind: 'personal' as const,
      owner_user_id: 2, owned_by_viewer: false,
    },
  ])
  render(<KnowledgePage api={service} />)
  const personal = (await screen.findByText('个人知识库')).closest('.dsh-knowledge-group') as HTMLElement
  expect(within(personal).getByRole('button', { name: '我的资料' })).toBeTruthy()
  expect(within(personal).queryByRole('button', { name: '他人笔记' })).toBeNull()
  expect(screen.queryByRole('button', { name: '他人笔记' })).toBeNull()
})

it('hides auth category names from the sidebar and discovers them only in the plaza', async () => {
  const service = api()
  const plazaItem = {
    id: 9,
    name: '地方法规知识库',
    description: '地方法规合集',
    kind: 'common' as const,
    owner_user_id: 2,
    category_id: 4,
    category_name: '法律',
    owner_username: '法务平台',
    subscription_status: 'none' as const,
    updated_at: '2026-10-12T08:00:00Z',
    document_count: 12,
    document_bytes: 2_516_582,
    subscriber_count: 8,
  }
  service.categories = vi.fn(async () => [
    { id: 3, name: '公开规范', type: 'common' as const, require_auth: false },
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    { id: 5, name: '公开汇编', description: '开放', kind: 'common' as const, owner_user_id: 2, category_id: 3 },
  ])
  service.plaza = vi.fn(async () => [plazaItem])
  service.plazaItem = vi.fn(async () => plazaItem)
  service.plazaDocuments = vi.fn(async () => [
    { id: 'doc-zhejiang', name: '浙江省/条例.pdf', location: '浙江省/条例.pdf', size: 1024, run: 'DONE', progress: 1, update_time: 1_729_036_800 },
    { id: 'doc-anhui', name: '安徽省/办法.pdf', location: '安徽省/办法.pdf', size: 1024, run: 'DONE', progress: 1, update_time: 1_729_036_800 },
  ])
  service.subscribe = vi.fn(async () => {})
  const { container } = render(<KnowledgePage api={service} />)
  expect(await screen.findByText('公共知识库')).toBeTruthy()
  expect(screen.queryByText('公开规范')).toBeNull()
  expect(screen.queryByText('法律')).toBeNull()
  expect(screen.getByRole('button', { name: '展开订阅知识库' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '展开公共知识库' })).toBeTruthy()
  expect(screen.queryByText('公开汇编')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开公共知识库' }))
  const open = screen.getByText('公共知识库').closest('.dsh-knowledge-group')
  expect(within(open as HTMLElement).getByText('公开汇编')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const emptySubscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(emptySubscription).getByText('暂无知识库')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /知识库广场/ }))
  const card = await screen.findByRole('button', { name: /地方法规知识库/ })
  expect(card.querySelector('img')?.getAttribute('src')).toBe('/knowledge-covers/plaza-natural-resources.jpg')
  expect(card.textContent).toContain('维护者')
  expect(card.textContent).toContain('法务平台')
  expect(card.textContent).toContain('更新时间')
  expect(card.textContent).toContain('2026-10-12')
  expect(card.textContent).toContain('文件数量')
  expect(card.textContent).toContain('12个')
  expect(card.textContent).toContain('文件大小')
  expect(card.textContent).toContain('2.4MB')
  expect(card.textContent).toContain('已订阅')
  expect(card.textContent).toContain('8人')
  const plazaMeta = card.querySelector('.dsh-knowledge-plaza-meta.card-layout') as HTMLElement
  expect(plazaMeta).toBeTruthy()
  expect(plazaMeta.querySelectorAll('.dsh-knowledge-plaza-meta-col')).toHaveLength(2)
  expect(plazaMeta.querySelectorAll('strong')).toHaveLength(4)
  expect(screen.queryByText(/订阅后需管理员审核/)).toBeNull()
  expect(container.querySelector('.dsh-knowledge-pager.dsh-knowledge-plaza-pager')).toBeTruthy()
  expect(screen.queryByRole('tab')).toBeNull()
  expect(service.plaza).toHaveBeenCalledWith({})
  fireEvent.click(screen.getByRole('button', { name: /地方法规知识库/ }))
  expect(await screen.findByRole('button', { name: '订阅' })).toBeTruthy()
  expect(screen.queryByText(/订阅后需管理员审核/)).toBeNull()
  const detailRoot = document.querySelector('.dsh-knowledge-plaza-detail.with-files') as HTMLElement
  expect(detailRoot).toBeTruthy()
  const detail = screen.getByRole('button', { name: '订阅' }).closest('.dsh-knowledge-plaza-detail-main') as HTMLElement
  expect(detail.querySelector('.dsh-knowledge-plaza-status')).toBeNull()
  expect(detail.textContent).toContain('授权知识库')
  expect(detail.textContent).toContain('法律')
  expect(detail.textContent).toContain('维护者')
  expect(detail.textContent).toContain('法务平台')
  expect(detail.textContent).toContain('12个')
  expect(detail.textContent).toContain('2.4MB')
  expect(detail.textContent).toContain('8人')
  expect(detailRoot.querySelector('.dsh-knowledge-plaza-detail-left .dsh-knowledge-plaza-content')).toBeNull()
  expect(detailRoot.querySelector(':scope > .dsh-knowledge-plaza-content')).toBeTruthy()
  expect(await screen.findByText('浙江省')).toBeTruthy()
  expect(screen.getByText('安徽省')).toBeTruthy()
  const plazaContent = detailRoot.querySelector(':scope > .dsh-knowledge-plaza-content') as HTMLElement
  expect(plazaContent.querySelector('.dsh-knowledge-plaza-content-head')?.textContent).toContain('内容')
  expect(plazaContent.querySelector('.dsh-knowledge-plaza-content-count')?.textContent).toBe('2')
  expect(plazaContent.querySelector('.dsh-knowledge-plaza-content-icon')).toBeNull()
  expect(plazaContent.querySelector('.dsh-knowledge-plaza-files')?.contains(
    plazaContent.querySelector('.dsh-knowledge-plaza-content-head')!)).toBe(false)
  expect(document.querySelector('.dsh-knowledge-plaza-detail-chat')).toBeNull()
  expect(service.plazaDocuments).toHaveBeenCalledWith(9)
  fireEvent.click(screen.getByRole('button', { name: '订阅' }))
  await waitFor(() => expect(service.subscribe).toHaveBeenCalledWith(9))
  expect(await screen.findByRole('button', { name: '审核中' })).toBeTruthy()
  expect(document.querySelector('.dsh-knowledge-plaza-detail.with-files')).toBeTruthy()
  expect(document.querySelector('.dsh-knowledge-plaza-detail-chat')).toBeNull()
})

it('keeps approved libraries on the plaza with Q&A and openable files', async () => {
  const service = api()
  const plazaItem = {
    id: 9,
    name: '地方法规知识库',
    description: '地方法规合集',
    kind: 'common' as const,
    owner_user_id: 2,
    category_id: 4,
    category_name: '法律',
    owner_username: '法务平台',
    subscription_status: 'approved' as const,
    updated_at: '2026-10-12T08:00:00Z',
    document_count: 2,
    document_bytes: 2048,
    subscriber_count: 8,
  }
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 9, name: '地方法规知识库', description: '地方法规合集', kind: 'common' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  service.plaza = vi.fn(async () => [plazaItem])
  service.plazaItem = vi.fn(async () => plazaItem)
  service.plazaDocuments = vi.fn(async () => [
    { id: 'doc-1', name: '说明.pdf', size: 2048, run: 'DONE', progress: 1 },
  ])
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    onProgress?.({ answer: '广场回答', recommendations: [], done: true })
    return { answer: '广场回答', recommendations: [] }
  })
  service.download = vi.fn(async () => ({
    contentType: 'application/pdf',
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  }))
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /知识库广场/ }))
  const plaza = await screen.findByRole('region', { name: '知识库广场' })
  const card = within(plaza).getByRole('button', { name: /地方法规知识库/ })
  expect(card.textContent).toContain('已订阅')
  expect(card.textContent).toContain('8人')
  fireEvent.click(card)
  expect(await within(plaza).findByText('知识库详情')).toBeTruthy()
  const detail = plaza.querySelector('.dsh-knowledge-plaza-detail.with-chat') as HTMLElement
  expect(detail).toBeTruthy()
  expect(detail.querySelector('.dsh-knowledge-plaza-status.subscribed')?.textContent).toBe('已订阅')
  expect(within(detail).queryByRole('button', { name: '订阅' })).toBeNull()
  expect(detail.querySelector('.dsh-knowledge-plaza-detail-left .dsh-knowledge-plaza-content')).toBeTruthy()
  const chat = plaza.querySelector('.dsh-knowledge-plaza-detail-chat') as HTMLElement
  expect(within(chat).getByPlaceholderText('基于知识库提问')).toBeTruthy()
  fireEvent.click(within(plaza).getByText('说明.pdf'))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(9, 'doc-1'))
  fireEvent.change(within(chat).getByPlaceholderText('基于知识库提问'), { target: { value: '概括一下' } })
  fireEvent.click(within(chat).getByRole('button', { name: '发送' }))
  await waitFor(() => expect(service.complete).toHaveBeenCalledWith(
    9, '概括一下', expect.any(Function), expect.any(AbortSignal), undefined, 0,
  ))
  expect(await within(chat).findByText('广场回答')).toBeTruthy()
})

it('places approved auth-category libraries under 订阅知识库 instead of the category name', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 8, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('订阅知识库')).toBeTruthy()
  expect(screen.queryByText('法律')).toBeNull()
  expect(screen.queryByText('已订法规')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group')
  expect(within(subscription as HTMLElement).getByText('已订法规')).toBeTruthy()
})

it('keeps admin-created auth libraries out of 订阅知识库 until a grant exists', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  // Accessible only as owner (or mistakenly listed): no grant → not under 订阅知识库.
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 9, name: '平台法规', description: '管理员创建', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: false,
    },
  ])
  service.plaza = vi.fn(async () => [{
    id: 9, name: '平台法规', description: '管理员创建', kind: 'shared' as const,
    owner_user_id: 2, category_id: 4, category_name: '法律',
    owner_username: 'admin', subscription_status: 'none' as const,
  }])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByRole('button', { name: '我的资料' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '展开订阅知识库' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(subscription).getByText('暂无知识库')).toBeTruthy()
  expect(within(subscription).queryByText('平台法规')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /知识库广场/ }))
  const plaza = await screen.findByRole('region', { name: '知识库广场' })
  expect(within(plaza).getByRole('button', { name: /平台法规/ })).toBeTruthy()
})

it('keeps owned auth libraries on the plaza as 我的 after grants, not under 订阅知识库', async () => {
  const service = api()
  const ownedPlaza = {
    id: 8,
    name: '我建的法规',
    description: '自建',
    kind: 'shared' as const,
    owner_user_id: 7,
    category_id: 4,
    category_name: '法律',
    owner_username: '我',
    subscription_status: 'owned' as const,
    updated_at: '2026-10-12T08:00:00Z',
    document_count: 1,
    document_bytes: 1024,
    subscriber_count: 0,
  }
  const grantedPlaza = {
    id: 9,
    name: '已订法规',
    description: '已通过',
    kind: 'shared' as const,
    owner_user_id: 2,
    category_id: 4,
    category_name: '法律',
    owner_username: '法务',
    subscription_status: 'approved' as const,
    updated_at: '2026-10-12T09:00:00Z',
    document_count: 2,
    document_bytes: 2048,
    subscriber_count: 3,
  }
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 9, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
    {
      id: 8, name: '我建的法规', description: '自建', kind: 'shared' as const,
      owner_user_id: 7, category_id: 4, owned_by_viewer: true, subscribed_by_viewer: false,
    },
  ])
  service.plaza = vi.fn(async () => [grantedPlaza, ownedPlaza])
  service.plazaItem = vi.fn(async () => ownedPlaza)
  service.plazaDocuments = vi.fn(async () => [
    { id: 'doc-1', name: '说明.pdf', location: '说明.pdf', size: 1024, run: 'DONE', progress: 1, update_time: 1_729_036_800 },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('订阅知识库')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(subscription).getByText('已订法规')).toBeTruthy()
  expect(within(subscription).queryByText('我建的法规')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /知识库广场/ }))
  const plaza = await screen.findByRole('region', { name: '知识库广场' })
  const cards = within(plaza).getAllByRole('button').filter(button =>
    (button.textContent || '').includes('法规'))
  expect(cards).toHaveLength(2)
  expect(cards[0]!.textContent).toContain('已订法规')
  expect(cards[0]!.textContent).toContain('已订阅')
  expect(cards[1]!.textContent).toContain('我建的法规')
  expect(cards[1]!.textContent).toContain('我的')
  fireEvent.click(cards[1]!)
  expect(await within(plaza).findByText('知识库详情')).toBeTruthy()
  const ownedDetail = plaza.querySelector('.dsh-knowledge-plaza-detail.with-chat') as HTMLElement
  expect(ownedDetail.querySelector('.dsh-knowledge-plaza-status.owned')?.textContent).toBe('我的')
  expect(within(ownedDetail).queryByRole('button', { name: '订阅' })).toBeNull()
  expect(plaza.querySelector('.dsh-knowledge-plaza-detail-chat')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '取消订阅' })).toBeNull()
})

it('collapses and expands each sidebar knowledge group', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 8, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByRole('button', { name: '收起个人知识库' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '展开订阅知识库' })).toBeTruthy()
  expect(screen.queryByText('已订法规')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  expect(screen.getByText('已订法规')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '收起订阅知识库' }))
  expect(screen.queryByText('已订法规')).toBeNull()
  const personal = screen.getByText('个人知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(personal).getByText('我的资料')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '收起个人知识库' }))
  expect(within(personal).queryByText('我的资料')).toBeNull()
})

it('unsubscribes a subscribed library so it leaves 订阅知识库', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 8, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  service.unsubscribe = vi.fn(async () => {
    service.list = vi.fn(async () => [
      { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    ])
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: '展开订阅知识库' }))
  fireEvent.click(await screen.findByRole('button', { name: '已订法规' }))
  expect(await screen.findByRole('button', { name: '取消订阅' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '取消订阅' }))
  await waitFor(() => expect(service.unsubscribe).toHaveBeenCalledWith(8))
  await waitFor(() => {
    const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
    expect(within(subscription).getByText('暂无知识库')).toBeTruthy()
    expect(within(subscription).queryByText('已订法规')).toBeNull()
  })
})

it('keeps 个人知识库 and 订阅知识库 visible when empty and hides empty 公共知识库', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 3, name: '公开规范', type: 'common' as const, require_auth: false },
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findAllByText('我的资料')).not.toHaveLength(0)
  expect(screen.queryByText('公共知识库')).toBeNull()
  expect(screen.queryByText('公开规范')).toBeNull()
  const personal = screen.getByText('个人知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(personal).getByText('我的资料')).toBeTruthy()
  expect(screen.getByRole('button', { name: '展开订阅知识库' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(subscription).getByText('暂无知识库')).toBeTruthy()
})

it('navigates uploaded directories with breadcrumbs and returns to the parent', async () => {
  const service = api()
  service.documents = vi.fn(async () => [
    { id: 'doc-1', name: '资料/说明.pdf', location: '资料/说明.pdf', size: 2048, run: 'DONE', progress: 1 },
    { id: 'doc-2', name: '资料/子目录/笔记.md', location: '资料/子目录/笔记.md', size: 128, run: 'DONE', progress: 1 },
    { id: 'doc-3', name: '根目录.txt', size: 32, run: 'DONE', progress: 1 },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByRole('button', { name: /^资料/ })).toBeTruthy()
  expect(screen.queryByText('说明.pdf')).toBeNull()
  expect(screen.getByText('根目录.txt')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^资料/ }))
  expect(screen.getByText('说明.pdf')).toBeTruthy()
  expect(screen.queryByText('根目录.txt')).toBeNull()
  expect(screen.queryByText('笔记.md')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /子目录/ }))
  expect(await screen.findByText('笔记.md')).toBeTruthy()
  expect(screen.queryByText('说明.pdf')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '返回上级' }))
  expect(screen.getByText('说明.pdf')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '全部文件' }))
  expect(screen.getByText('根目录.txt')).toBeTruthy()
  expect(screen.queryByText('说明.pdf')).toBeNull()
})

it('shows plaza-style stats on sidebar cards and renders content as cards', async () => {
  const service = api()
  service.list = vi.fn(async () => [
    {
      id: 1, name: '我的资料', description: '个人笔记', kind: 'personal' as const, owner_user_id: 7,
      owner_username: '小王', document_count: 9, document_bytes: 2_516_582, subscriber_count: 3,
      updated_at: '2026-10-12T08:00:00Z',
    },
    { id: 2, name: '第二个库', description: '个人', kind: 'personal' as const, owner_user_id: 7, document_count: 4 },
  ])
  service.documents = vi.fn(async () => [
    { id: 'doc-1', name: '资料/说明.pdf', location: '资料/说明.pdf', size: 2048, run: 'DONE', progress: 1 },
    { id: 'doc-2', name: '根目录.txt', size: 32, run: 'DONE', progress: 1 },
  ])
  render(<KnowledgePage api={service} networkMode="intranet" />)
  expect(await screen.findByText('根目录.txt')).toBeTruthy()
  const personal = screen.getByText('个人知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(personal.querySelector('.dsh-knowledge-group-count')?.textContent).toBe('2')
  const card = within(personal).getByText('我的资料').closest('.dsh-knowledge-lib-card') as HTMLElement
  expect(within(card).queryByText('个人')).toBeNull()
  for (const label of ['维护者', '更新时间', '文件数量', '文件大小']) {
    expect(within(card).getByText(label)).toBeTruthy()
  }
  expect(card.querySelector('.dsh-knowledge-plaza-meta.card-layout')).toBeTruthy()
  expect(card.querySelectorAll('.dsh-knowledge-plaza-meta-col')).toHaveLength(2)
  expect(within(card).queryByText('已订阅')).toBeNull()
  expect(card.textContent).toContain('小王')
  expect(card.textContent).toContain('2026-10-12')
  // The loaded document list replaces the list's file count and size for the selected library.
  expect(card.textContent).toContain('2个')
  expect(card.textContent).not.toContain('3人')
  expect(card.querySelector('.dsh-knowledge-lib-card-main img')).toBeNull()
  expect(card.querySelector('.dsh-knowledge-lib-chat img')?.getAttribute('src'))
    .toBe('/knowledge-covers/icon-lib-chat.png')
  const second = within(personal).getByText('第二个库').closest('.dsh-knowledge-lib-card') as HTMLElement
  expect(second.textContent).toContain('4个')
  expect(second.textContent).toContain('未知作者')
  const file = screen.getByText('根目录.txt').closest('button') as HTMLElement
  expect(file.className).toContain('dsh-knowledge-card')
  expect(within(file).getByText('文件')).toBeTruthy()
  const folder = screen.getByRole('button', { name: /^资料文件夹/ })
  expect(folder.className).toContain('dsh-knowledge-card')
  expect(screen.queryByText('说明.pdf')).toBeNull()
  fireEvent.click(folder)
  expect(screen.getByText('说明.pdf')).toBeTruthy()
  expect(screen.queryByText('根目录.txt')).toBeNull()
})

it('shows deployment maintainers, collapsible descriptions, two tags and subscription statistics', async () => {
  const service = api()
  service.categories = vi.fn(async () => [{ id: 6, name: '行业资料', type: 'common' as const, require_auth: true }])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '个人资料的完整描述', kind: 'personal' as const, owner_user_id: 7,
      owner_username: '小王', tags: '土地，规划、测绘,土地' },
    { id: 2, name: '公开资料', description: '公开资料的完整描述', kind: 'common' as const, owner_user_id: 8,
      owner_username: '小李' },
    { id: 3, name: '订阅课程', description: '订阅课程说明', kind: 'common' as const, owner_user_id: 8,
      category_id: 6, subscribed_by_viewer: true, owner_username: '小李', subscriber_count: 18, visit_count: 123 },
  ])
  const view = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.click(screen.getByRole('button', { name: '展开公共知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const card = (name: string) => screen.getByRole('button', { name }).closest('.dsh-knowledge-lib-card') as HTMLElement
  for (const name of ['我的资料', '公开资料']) {
    const toggle = within(card(name)).getByRole('button', { name: `展开：${name}` })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(card(name)).getByText('维护者')).toBeTruthy()
    expect(within(card(name)).getByText('文件数量')).toBeTruthy()
    expect(card(name).querySelector('.dsh-knowledge-lib-card-desc')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(card(name).textContent).toContain('完整描述')
    fireEvent.click(toggle)
    expect(within(card(name)).getByText('维护者')).toBeTruthy()
    expect(within(card(name)).getByText('文件数量')).toBeTruthy()
    expect(card(name).querySelector('.dsh-knowledge-lib-card-desc')).toBeNull()
    fireEvent.click(toggle)
  }
  expect(within(card('订阅课程')).queryByText('订阅量')).toBeNull()
  expect(within(card('订阅课程')).queryByText('浏览量')).toBeNull()
  expect(within(card('订阅课程')).getByText('文件数量')).toBeTruthy()
  fireEvent.click(within(card('订阅课程')).getByRole('button', { name: '展开：订阅课程' }))
  const personal = card('我的资料')
  expect([...personal.querySelectorAll('.dsh-knowledge-lib-tags > span')].map(tag => tag.textContent)).toEqual(['土地', '规划'])
  expect(within(personal).getByText('小王')).toBeTruthy()
  expect(within(personal).queryByText('万维')).toBeNull()
  expect(within(personal).queryByText('订阅量')).toBeNull()
  const subscription = card('订阅课程')
  expect(within(subscription).getByText('订阅量').parentElement?.textContent).toBe('订阅量18')
  expect(within(subscription).getByText('浏览量').parentElement?.textContent).toBe('浏览量123')
  const body = subscription.querySelector('.dsh-knowledge-lib-card-body') as HTMLElement
  const details = body.querySelector('.dsh-knowledge-lib-details') as HTMLElement
  expect(details.previousElementSibling?.classList.contains('dsh-knowledge-plaza-meta')).toBe(true)
  expect(details.firstElementChild?.textContent).toBe('订阅课程说明')
  expect(within(details).getByText('订阅量')).toBeTruthy()
  expect(within(details).getByText('浏览量')).toBeTruthy()
  view.rerender(<KnowledgePage api={service} networkMode="intranet" />)
  expect(within(personal).getByText('小王')).toBeTruthy()
  expect(within(subscription).getByText('小李')).toBeTruthy()
  fireEvent.click(within(subscription).getByRole('button', { name: '收起：订阅课程' }))
  expect(within(subscription).queryByText('订阅量')).toBeNull()
  expect(within(subscription).queryByText('浏览量')).toBeNull()
  expect(within(subscription).getByText('维护者')).toBeTruthy()
  expect(within(subscription).getByText('文件数量')).toBeTruthy()
  expect(within(personal).queryByText('万维')).toBeNull()
})

it('closes library details on selection changes without restoring them on return', async () => {
  const service = api()
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '个人描述', kind: 'personal' as const, owner_user_id: 7 },
    { id: 2, name: '第二个库', description: '第二个描述', kind: 'personal' as const, owner_user_id: 7 },
  ])
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const card = (name: string) => within(screen.getByRole('button', { name }).closest('.dsh-knowledge-lib-card') as HTMLElement)
  fireEvent.click(screen.getByRole('button', { name: '展开：我的资料' }))
  fireEvent.click(screen.getByRole('button', { name: '展开：第二个库' }))
  expect(card('我的资料').getByText('个人描述')).toBeTruthy()
  expect(card('第二个库').getByText('第二个描述')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '第二个库' }))
  expect(card('我的资料').queryByText('个人描述')).toBeNull()
  expect(card('第二个库').queryByText('第二个描述')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开：第二个库' }))
  fireEvent.click(screen.getByRole('button', { name: '我的资料' }))
  expect(card('第二个库').queryByText('第二个描述')).toBeNull()
  expect(screen.getByRole('button', { name: '展开：我的资料' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '展开：我的资料' }))
  fireEvent.click(screen.getByRole('button', { name: '我的资料' }))
  expect(card('我的资料').getByText('个人描述')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '打开问答：第二个库' }))
  expect(card('我的资料').queryByText('个人描述')).toBeNull()
  expect(screen.getByRole('button', { name: '展开：第二个库' }).getAttribute('aria-expanded')).toBe('false')
})

it('keeps Q&A closed by default and toggles it from the library card without a resize divider', async () => {
  const { container } = render(<KnowledgePage api={api()} />)
  await screen.findByText('说明.pdf')
  expect(container.querySelector('.dsh-knowledge-chat')).toBeNull()
  expect(container.querySelector('.dsh-knowledge')?.className).not.toContain('chat-open')
  expect(screen.getByRole('navigation', { name: '文件分页' })).toBeTruthy()
  expect(screen.queryByRole('separator')).toBeNull()
  const toggle = screen.getByRole('button', { name: '打开问答：我的资料' })
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(toggle)
  expect(container.querySelector('.dsh-knowledge-chat')).toBeTruthy()
  expect(container.querySelector('.dsh-knowledge')?.className).toContain('chat-open')
  expect(screen.queryByRole('navigation', { name: '文件分页' })).toBeNull()
  const close = screen.getByRole('button', { name: '关闭问答：我的资料' })
  expect(close.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(close)
  expect(container.querySelector('.dsh-knowledge-chat')).toBeNull()
})

it('opens Q&A for another library when its card toggle is pressed', async () => {
  const service = api()
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    { id: 2, name: '第二个库', description: '个人', kind: 'personal' as const, owner_user_id: 7 },
  ])
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.click(screen.getByRole('button', { name: '打开问答：第二个库' }))
  await waitFor(() => expect(service.documents).toHaveBeenCalledWith(2))
  expect(container.querySelector('.dsh-knowledge-chat')).toBeTruthy()
  expect(screen.getByRole('button', { name: '关闭问答：第二个库' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '打开问答：我的资料' })).toBeTruthy()
})

it('filters the sidebar by library name and expands matching groups', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    { id: 2, name: '工作笔记', description: '个人', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 8, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  expect(screen.queryByText('已订法规')).toBeNull()
  const search = screen.getByRole('searchbox', { name: '搜索知识库名称' })
  fireEvent.change(search, { target: { value: '法规' } })
  expect(screen.getByText('已订法规')).toBeTruthy()
  expect(screen.queryByText('工作笔记')).toBeNull()
  expect(screen.queryByText('个人知识库')).toBeNull()
  fireEvent.change(search, { target: { value: '不存在的库' } })
  expect(screen.getByText('没有匹配的知识库')).toBeTruthy()
  fireEvent.change(search, { target: { value: '' } })
  expect(screen.getByText('工作笔记')).toBeTruthy()
  expect(screen.queryByText('已订法规')).toBeNull()
})

it('searches and sorts visible file cards while PDF thumbnails are pending', async () => {
  const service = api()
  const day = (value: string) => new Date(value).getTime()
  service.documents = vi.fn(async () => [
    { id: 'doc-old', name: '旧规范.pdf', size: 100, run: 'DONE', progress: 1, create_time: day('2026-10-01T08:30:00') },
    {
      id: 'doc-new', name: '新规范.pdf', size: 100, run: 'DONE', progress: 1,
      create_time: day('2026-10-20T09:05:00'), creator_name: '小李',
    },
    { id: 'doc-memo', name: '备忘.txt', size: 100, run: 'DONE', progress: 1, create_time: day('2026-10-10T10:00:00') },
  ])
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('新规范.pdf')
  const order = () => [...container.querySelectorAll('.dsh-knowledge-card-details > strong')].map(node => node.textContent)
  expect(order()).toEqual(['新规范.pdf', '备忘.txt', '旧规范.pdf'])
  expect(container.querySelector('.dsh-knowledge-documents')?.hasAttribute('hidden')).toBe(false)
  expect(container.querySelectorAll('.dsh-knowledge-document-cover.pdf')).toHaveLength(2)
  expect(container.querySelector('.dsh-knowledge-thumbnail.pdf img')).toBeNull()
  expect(service.download).not.toHaveBeenCalled()
  const fresh = screen.getByText('新规范.pdf').closest('button') as HTMLElement
  expect(fresh.title).toContain('2026-10-20 09:05')
  expect(fresh.textContent).toContain('创建人')
  expect(fresh.textContent).toContain('小李')
  // The viewer's own files arrive without a creator name and show no creator row.
  const own = screen.getByText('旧规范.pdf').closest('button') as HTMLElement
  expect(own.title).toContain('2026-10-01 08:30')
  expect(own.textContent).not.toContain('创建人')
  fireEvent.click(screen.getByRole('button', { name: '按上传时间排序' }))
  expect(order()).toEqual(['旧规范.pdf', '备忘.txt', '新规范.pdf'])
  expect(screen.getByText('最早上传')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索文件名称' }), { target: { value: '规范' } })
  expect(order()).toEqual(['旧规范.pdf', '新规范.pdf'])
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索文件名称' }), { target: { value: '没有这个文件' } })
  expect(screen.getByText('未找到匹配的文件')).toBeTruthy()
})

it('refreshes a pending cover without downloading the PDF', async () => {
  const service = api()
  service.documents = vi.fn(async (_id, refresh) => decodeKnowledgeDocuments([{
    id: 'doc-1', name: '说明.pdf', size: 2048, run: 'DONE', progress: 1,
    cover_status: refresh ? 'ready' : 'pending',
  }]))
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const image = () => container.querySelector('.dsh-knowledge-thumbnail.pdf img')
  expect(image()).toBeNull()
  await waitFor(() => expect(image()?.getAttribute('src')).toBe('/api/desktop-knowledge-file?id=1&documentId=doc-1&cover=1'), {
    timeout: 4000,
  })
  expect(service.download).not.toHaveBeenCalled()
})

it('paginates content and resets to the first page when the search changes', async () => {
  const service = api()
  service.documents = vi.fn(async () => Array.from({ length: 30 }, (_, index) => ({
    id: `doc-${index}`, name: `文件${String(index).padStart(2, '0')}.txt`, size: 10, run: 'DONE', progress: 1,
    create_time: 1_760_000_000_000 + index * 1000,
  })))
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('文件29.txt')
  expect(container.querySelectorAll('.dsh-knowledge-card')).toHaveLength(12)
  expect(screen.queryByText('文件00.txt')).toBeNull()
  expect(screen.getByText('内容').textContent).toBe('内容30')
  expect(screen.queryByRole('heading', { name: '文件' })).toBeNull()
  expect(screen.queryByText('共 30 项')).toBeNull()
  expect(screen.getByText('第 1 页 / 3')).toBeTruthy()
  expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
  expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(container.querySelectorAll('.dsh-knowledge-card')).toHaveLength(12)
  expect(screen.getByText('文件17.txt')).toBeTruthy()
  expect(screen.getByText('第 2 页 / 3')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: '跳转页码' }), { target: { value: '3' } })
  fireEvent.submit(screen.getByRole('textbox', { name: '跳转页码' }).closest('form')!)
  expect(container.querySelectorAll('.dsh-knowledge-card')).toHaveLength(6)
  expect(screen.getByText('文件00.txt')).toBeTruthy()
  expect(screen.getByText('第 3 页 / 3')).toBeTruthy()
  expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索文件名称' }), { target: { value: '文件0' } })
  expect(screen.getByText('第 1 页 / 1')).toBeTruthy()
  expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true)
  expect(container.querySelectorAll('.dsh-knowledge-card')).toHaveLength(10)
})

it('restores saved Q&A turns when opening a knowledge base', async () => {
  const service = api()
  service.messages = vi.fn(async () => [
    { role: 'user' as const, content: '上次的问题' },
    { role: 'assistant' as const, content: '上次的回答' },
  ])
  const { container } = render(<KnowledgePage api={service} />)
  await waitFor(() => expect(service.messages).toHaveBeenCalledWith(1))
  await openChat()
  const pane = container.querySelector('.dsh-knowledge-messages') as HTMLDivElement
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => 960 })
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  expect(screen.getByText('上次的回答')).toBeTruthy()
  expect(screen.getByText('万维Buddy')).toBeTruthy()
  expect(pane.scrollTop).toBe(0)
})

it('clears saved Q&A turns and leaves the empty knowledge chat', async () => {
  const service = api()
  service.messages = vi.fn(async () => [
    { role: 'user' as const, content: '上次的问题' },
    { role: 'assistant' as const, content: '上次的回答' },
  ])
  render(<KnowledgePage api={service} />)
  await openChat()
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '清空会话' }))
  await waitFor(() => expect(service.clearMessages).toHaveBeenCalledWith(1))
  await waitFor(() => expect(screen.queryByText('上次的问题')).toBeNull())
  expect(screen.queryByText('上次的回答')).toBeNull()
  expect(screen.getByText('基于知识库问答')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '清空会话' })).toBeNull()
})

it('restores Q&A turns when clearing the session fails', async () => {
  const service = api()
  service.messages = vi.fn(async () => [
    { role: 'user' as const, content: '上次的问题' },
    { role: 'assistant' as const, content: '上次的回答' },
  ])
  service.clearMessages = vi.fn(async () => { throw new Error('网络中断') })
  render(<KnowledgePage api={service} />)
  await openChat()
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '清空会话' }))
  expect((await screen.findByRole('alert')).textContent ?? '').toContain('清空失败')
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  expect(screen.getByText('上次的回答')).toBeTruthy()
})

it('formats answer timing and keeps three related questions', () => {
  expect(formatAnswerDurationSeconds(1_000, 1_450)).toBe('0.5')
  expect(formatAnswerDurationSeconds(1_000, 12_000)).toBe('11')
  expect(formatAnswerTiming(1_700_000_000_000, 1_700_000_008_200)).toMatch(/^开始时间 .+ · 结束时间 .+ · 回答耗时 8\.2秒$/)
  expect(relatedQuestions(['甲', '', '乙', '甲', '丙', '丁'])).toEqual(['甲？', '乙？', '丙？'])
  expect(relatedQuestions(['已有问号？', 'ascii?'])).toEqual(['已有问号？', 'ascii?'])
})

it('asks the selected knowledge base through chat completions and renders recommendations', async () => {
  const service = api()
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    onProgress?.({ answer: '知', done: false })
    onProgress?.({
      answer: '知识库回答',
      recommendations: ['继续提问', '第二问', '第三问', '第四问'],
      done: true,
    })
    return {
      answer: '知识库回答',
      recommendations: ['继续提问', '第二问', '第三问', '第四问'],
    }
  })
  const { container } = render(<KnowledgePage api={service} />)
  await openChat()
  const pane = container.querySelector('.dsh-knowledge-messages') as HTMLDivElement
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => 960 })
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '请概括文档' } })
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('ready')
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(service.complete).toHaveBeenCalled())
  expect(service.complete).toHaveBeenCalledWith(
    1, '请概括文档', expect.any(Function), expect.any(AbortSignal), undefined, 0,
  )
  expect(await screen.findByText('知识库回答')).toBeTruthy()
  expect(screen.getByText('万维Buddy')).toBeTruthy()
  expect(screen.getByText('推荐关联问题')).toBeTruthy()
  expect(screen.getByText('继续提问？')).toBeTruthy()
  expect(screen.getByText('第二问？')).toBeTruthy()
  expect(screen.getByText('第三问？')).toBeTruthy()
  expect(screen.queryByText('第四问？')).toBeNull()
  expect(container.querySelector('.dsh-knowledge-answer-meta')?.textContent).toMatch(/开始时间 .+ · 结束时间 .+ · 回答耗时 .+秒/)
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('idle')
  await waitFor(() => expect(pane.scrollTop).toBe(960))
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
  await openChat()
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '请概括文档' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByRole('status', { name: '正在回答…' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
  expect(screen.getByText('万维Buddy')).toBeTruthy()
  finish({ answer: '知识库回答', recommendations: [] })
  expect(await screen.findByText('知识库回答')).toBeTruthy()
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('idle')
})

it('opens a PDF preview with pdf.js when a content list item is clicked', async () => {
  const service = api()
  stubCanvas()
  const createObjectURL = vi.fn(() => 'blob:doc')
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true)
    expect(this.download).toBe('说明.pdf')
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'doc-1'))
  expect(service.chunks).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '说明.pdf' })).toBeTruthy()
  expect(await screen.findByAltText('PDF 1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '下载' }))
  await waitFor(() => expect(click).toHaveBeenCalled())
  // Preview already cached the original bytes; save should not download again.
  expect(service.download).toHaveBeenCalledTimes(1)
  expect(createObjectURL).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog', { name: '说明.pdf' })).toBeNull()
})

it('saves a previewed document through the desktop bridge and reports save failures inside the preview', async () => {
  const service = api()
  const invoke = vi.fn()
    .mockRejectedValueOnce('下载目录不可写')
    .mockResolvedValueOnce(undefined)
  vi.stubGlobal('__ZJUGIS_NATIVE_INVOKE__', invoke)
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  expect(await screen.findByAltText('PDF 1')).toBeTruthy()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  service.creditPrice = vi.fn(async () => ({
    enabled: true, applies: true, configured: true, preview_free: true, platform_percent: 30,
    price: { browse_cents: 0, question_cents: 0, download_cents: 50 },
  }))
  const preview = within(screen.getByRole('dialog', { name: '说明.pdf' }))
  const download = preview.getByRole('button', { name: '下载' })
  fireEvent.click(download)
  expect((await preview.findByRole('alert')).textContent).toBe('下载失败：下载目录不可写')
  fireEvent.click(download)
  expect((await preview.findByRole('status')).textContent).toBe('已保存到下载文件夹')
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke).toHaveBeenLastCalledWith('save_knowledge_download', { fileName: '说明.pdf', bytesBase64: 'JVBERg==' })
  expect(service.download).toHaveBeenCalledTimes(2)
  expect(service.download).toHaveBeenLastCalledWith(1, 'doc-1', expect.objectContaining({ action: 'download', expectedCents: 50 }))
  expect(confirm).toHaveBeenCalledTimes(1)
})

it('opens 问问万维 beside a preview and asks the current knowledge base about that file', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = { answer: '这是文件摘要', recommendations: [] as string[] }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  const dialog = await screen.findByRole('dialog', { name: '说明.pdf' })
  fireEvent.click(within(dialog).getByRole('button', { name: '问问万维' }))
  const ask = within(dialog).getByRole('complementary', { name: '问问万维' })
  expect(within(ask).getByText('你好，我是你的智能助手万维，能帮你速读文章、答疑解惑，快向我提问吧！')).toBeTruthy()
  expect(within(ask).queryByText('DS 快速')).toBeNull()
  expect(ask.querySelector('.dsh-knowledge-preview-ask-file .dsh-knowledge-file-icon.pdf img')).toBeTruthy()
  fireEvent.click(within(ask).getByRole('button', { name: '总结' }))
  await waitFor(() => expect(service.complete).toHaveBeenCalledWith(
    1, '请总结文档的主要内容、关键步骤与要点（文件：说明.pdf）。',
    expect.any(Function), expect.any(AbortSignal), 'doc-1', 0,
  ))
  expect(await within(ask).findByText('这是文件摘要')).toBeTruthy()
  fireEvent.click(within(ask).getByRole('button', { name: '关闭问问万维' }))
  expect(within(dialog).queryByRole('complementary', { name: '问问万维' })).toBeNull()
  expect(within(dialog).getByRole('button', { name: '问问万维' })).toBeTruthy()
})

it('locates a preview answer citation in the open preview without loading it again', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = {
      answer: '依据制度执行。##0$$',
      recommendations: [] as string[],
      citations: [{
        index: 1, chunk_index: 0, document_id: 'doc-1', document_name: '说明.pdf',
        quote: '适用范围', page: 1,
        positions: [{ page: 1, left: 0.1, right: 0.5, top: 0.2, bottom: 0.3 }],
      }],
    }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  const dialog = await screen.findByRole('dialog', { name: '说明.pdf' })
  await screen.findByAltText('PDF 1')
  fireEvent.click(within(dialog).getByRole('button', { name: '问问万维' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '总结' }))
  fireEvent.click(await within(dialog).findByRole('button', { name: '引用定位 【1】' }))
  expect(service.download).toHaveBeenCalledTimes(1)
  expect(within(dialog).getByRole('complementary', { name: '问问万维' })).toBeTruthy()
  await waitFor(() => expect(dialog.querySelector('.dsh-knowledge-pdf-hit')).toBeTruthy())
})

it('opens a cited PDF when a blue answer citation number is clicked', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = {
      answer: '依据制度执行。##0$$',
      recommendations: [] as string[],
      citations: [{
        index: 1, chunk_index: 0, document_id: 'doc-1', document_name: '说明.pdf',
        quote: '适用范围', page: 1,
        positions: [{ page: 1, left: 0.1, right: 0.5, top: 0.2, bottom: 0.3 }],
      }],
    }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  await openChat()
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '制度要求是什么' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByRole('button', { name: '引用定位 【1】' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '引用定位 【1】' }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'doc-1'))
  expect(screen.getByRole('dialog', { name: '说明.pdf' })).toBeTruthy()
})

it('turns answer [ID:i] markers into inline locate controls without trailing source chips', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = {
      answer: '准备工作包括：[ID:0]',
      recommendations: [] as string[],
      citations: [
        {
          index: 1, chunk_index: 0, document_id: 'doc-1', document_name: '说明.pdf',
          quote: '建表', page: 1,
          positions: [{ page: 1, left: 0.1, right: 0.5, top: 0.2, bottom: 0.3 }],
        },
        { index: 2, chunk_index: 1, document_id: 'doc-2', document_name: '其它.pdf', quote: '其它' },
      ],
    }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  await openChat()
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '准备工作是什么' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByRole('button', { name: '引用定位 【1】' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '引用定位 【2】' })).toBeNull()
  expect(screen.queryByText(/\[ID:0\]/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '引用定位 【1】' }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'doc-1'))
})

it('previews images through the original file blob', async () => {
  const service = api()
  service.documents = vi.fn(async () => [{ id: 'img-1', name: '截图.png', size: 128, run: 'DONE', progress: 1 }])
  service.download = vi.fn(async () => ({ contentType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }))
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /截图\.png/ }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'img-1'))
  expect(screen.getByRole('img', { name: '截图.png' })).toBeTruthy()
})

it('selects a personal-library document on right-click and shows delete only', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  const row = await screen.findByRole('button', { name: /说明\.pdf/ })
  fireEvent.contextMenu(row)
  expect(row.className).toContain('selected')
  expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '移动到' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '复制到' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '编辑标签' })).toBeNull()
})

it('clears the right-click selection when the delete menu is dismissed', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  const row = await screen.findByRole('button', { name: /说明\.pdf/ })
  fireEvent.contextMenu(row)
  expect(row.className).toContain('selected')
  expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy()
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull()
  expect(row.className).not.toContain('selected')
})

it('hides file context actions for public and subscribed libraries', async () => {
  const service = api()
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    { id: 8, name: '公开法规', description: '公共', kind: 'common' as const, owner_user_id: 1 },
    {
      id: 9, name: '已订法规', description: '订阅', kind: 'common' as const, owner_user_id: 1,
      category_id: 4, subscribed_by_viewer: true,
    },
  ])
  service.categories = vi.fn(async () => [
    { id: 4, name: '授权', type: 'common' as const, require_auth: true },
  ])
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.click(screen.getByRole('button', { name: '展开公共知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '公开法规' }))
  fireEvent.contextMenu(await screen.findByRole('button', { name: /说明\.pdf/ }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '已订法规' }))
  fireEvent.contextMenu(await screen.findByRole('button', { name: /说明\.pdf/ }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull()
})

it('asks for confirmation before deleting a selected document', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  fireEvent.contextMenu(await screen.findByRole('button', { name: /说明\.pdf/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
  const dialog = await screen.findByRole('dialog', { name: '确认删除' })
  expect(dialog.textContent).toContain('说明.pdf')
  expect(service.delete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(service.delete).toHaveBeenCalledWith(1, 'doc-1'))
})

it('restores saved likes after remounting and shares changes between plaza cards and detail', async () => {
  const service = api()
  let liked = false
  const item = () => ({
    id: 9, name: '法规资料', description: '法规', kind: 'shared' as const,
    owner_user_id: 2, category_id: 4, category_name: '法律',
    owner_username: 'admin', subscription_status: 'none' as const, liked_by_viewer: liked,
  })
  service.plaza = vi.fn(async () => [item()])
  service.plazaItem = vi.fn(async () => item())
  service.setLike = vi.fn(async (_id, value) => { liked = value })
  const view = render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /知识库广场/ }))
  fireEvent.click(await screen.findByRole('button', { name: '喜欢' }))
  await screen.findByRole('button', { name: '取消喜欢', pressed: true })
  expect(service.setLike).toHaveBeenCalledWith(9, true)
  expect(screen.queryByText('知识库详情')).toBeNull()
  view.unmount()
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /知识库广场/ }))
  await screen.findByRole('button', { name: '取消喜欢', pressed: true })
  fireEvent.click(screen.getByRole('button', { name: /法规资料/ }))
  await screen.findByText('知识库详情')
  fireEvent.click(screen.getByRole('button', { name: '取消喜欢' }))
  await screen.findByRole('button', { name: '喜欢', pressed: false })
  expect(service.setLike).toHaveBeenCalledWith(9, false)
  fireEvent.click(screen.getByRole('button', { name: '返回' }))
  await screen.findByRole('button', { name: '喜欢', pressed: false })
  cleanup()
})

it('keeps a saved heart when cancelling the like fails', async () => {
  const service = api()
  service.plaza = vi.fn(async () => [{
    id: 9, name: '法规资料', description: '法规', kind: 'shared' as const,
    owner_user_id: 2, category_id: 4, category_name: '法律', owner_username: 'admin',
    subscription_status: 'none' as const, liked_by_viewer: true,
  }])
  service.setLike = vi.fn(async () => { throw new Error('offline') })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /知识库广场/ }))
  fireEvent.click(await screen.findByRole('button', { name: '取消喜欢' }))
  await screen.findByText(/保存喜欢状态失败/)
  expect(screen.getByRole('button', { name: '取消喜欢', pressed: true }).hasAttribute('disabled')).toBe(false)
})

it('restores folder selection and saves empty folders across page mounts', async () => {
  const service = api()
  const saved: string[] = []
  service.folders = vi.fn(async () => [...saved])
  service.createFolder = vi.fn(async (_id, name) => { saved.push(name) })
  const view = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  const folderInput = view.container.querySelector('input[webkitdirectory]') as HTMLInputElement
  const pick = vi.spyOn(folderInput, 'click')
  fireEvent.click(screen.getByRole('menuitem', { name: '本地文件夹' }))
  expect(pick).toHaveBeenCalledOnce()
  const file = new File(['body'], '材料.txt', { type: 'text/plain' })
  Object.defineProperty(file, 'webkitRelativePath', { value: '资料/材料.txt' })
  fireEvent.change(folderInput, { target: { files: [file] } })
  await waitFor(() => expect(service.upload).toHaveBeenCalledWith(1, file))
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '新建文件夹' }))
  const dialog = screen.getByRole('dialog', { name: '新建文件夹' })
  fireEvent.change(within(dialog).getByLabelText('文件夹名称'), { target: { value: '新目录' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '确定' }))
  await waitFor(() => expect(service.createFolder).toHaveBeenCalledWith(1, '新目录'))
  expect(await screen.findByText('新目录')).toBeTruthy()
  view.unmount()
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('新目录')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '新建文件夹' }))
  fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '新目录' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确定' }))
  expect(screen.getByRole('alert').textContent).toContain('文件夹已存在')
  expect(service.createFolder).toHaveBeenCalledTimes(1)
})

it('selects a library by name and toggles its sidebar details from the chevron', async () => {
  const service = api()
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '个人描述', kind: 'personal' as const, owner_user_id: 7 },
    { id: 2, name: '第二个库', description: '第二个描述', kind: 'personal' as const, owner_user_id: 7 },
  ])
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const card = screen.getByRole('button', { name: '第二个库' }).closest('.dsh-knowledge-lib-card') as HTMLElement
  const toggle = within(card).getByRole('button', { name: '展开：第二个库' })
  fireEvent.click(toggle.querySelector('svg') as SVGElement)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(within(card).getByText('第二个描述')).toBeTruthy()
  expect(card.classList.contains('active')).toBe(false)
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(within(card).queryByText('第二个描述')).toBeNull()
  fireEvent.click(within(card).getByText('第二个库'))
  expect(card.classList.contains('active')).toBe(true)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  fireEvent.click(within(card).getByText('第二个库'))
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
})

it.each([
  ['public', undefined], ['subscription', undefined], ['public', true], ['subscription', true],
  ['public', false], ['subscription', false],
] as const)('keeps the personal maintainer while %s publication is pending with edition flag %s', async (target, edition) => {
  const service = api()
  service.list = vi.fn(async () => [{
    id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7,
    owner_username: '小王', ...(edition === undefined ? {} : { operations_edition: edition }),
  }])
  const request = { id: 1, category_id: 4, target, status: 'pending' as const, review_note: '' }
  let saved = false
  service.categories = vi.fn(async () => [
    { id: 4, name: '公共规范', type: 'common' as const, require_auth: false },
    { id: 5, name: '授权专业库', type: 'shared' as const, require_auth: true },
  ])
  service.publication = vi.fn(async () => ({ enabled: true, categories: await service.categories(), application: saved ? request : null }))
  service.applyPublication = vi.fn(async () => { saved = true; return request })
  const view = render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByText('发布'))
  fireEvent.click(screen.getByRole('button', { name: target === 'public' ? /转为公共知识库/ : /转为订阅知识库/ }))
  const dialog = await screen.findByRole('dialog', { name: '申请发布知识库' })
  expect(within(dialog).queryByRole('combobox')).toBeNull()
  expect(within(dialog).getByText('个人知识库中仍保留原库，内容同步更新。')).toBeTruthy()
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '可共享的规范' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '提交审核' }))
  await screen.findByText('发布申请待管理员审核')
  expect(service.applyPublication).toHaveBeenCalledWith(1, target, '可共享的规范')
  expect(screen.getByRole('button', { name: '我的资料' })).toBeTruthy()
  const personal = screen.getByRole('button', { name: '我的资料' }).closest('.dsh-knowledge-lib-card') as HTMLElement
  expect(within(personal).getByText('小王')).toBeTruthy()
  expect(within(personal).queryByText('万维')).toBeNull()
  expect(screen.queryByText('公共知识库')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const subscriptions = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(subscriptions).queryByRole('button', { name: '我的资料' })).toBeNull()
  view.unmount()
  render(<KnowledgePage api={service} />)
  await screen.findByText('发布申请待管理员审核')
  const restored = screen.getByRole('button', { name: '我的资料' }).closest('.dsh-knowledge-lib-card') as HTMLElement
  expect(within(restored).getByText('小王')).toBeTruthy()
  expect(within(restored).queryByText('万维')).toBeNull()
  expect(screen.queryByText('公共知识库')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  const restoredSubscriptions = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(restoredSubscriptions).queryByRole('button', { name: '我的资料' })).toBeNull()
  expect(screen.queryByRole('button', { name: '转为公共知识库' })).toBeNull()
})

it('shows a rejected publication reason and allows resubmitting directly to subscription scope', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '公共规范', type: 'common' as const, require_auth: false },
    { id: 5, name: '授权专业库', type: 'shared' as const, require_auth: true },
  ])
  service.publication = vi.fn(async () => ({ enabled: true, categories: await service.categories(), application: {
    id: 1, category_id: 4, target: 'public' as const, status: 'rejected' as const, review_note: '请移除私人信息',
  } }))
  render(<KnowledgePage api={service} />)
  await screen.findByText(/请移除私人信息/)
  fireEvent.click(screen.getByText('发布'))
  fireEvent.click(screen.getByRole('button', { name: /转为订阅知识库/ }))
  const dialog = await screen.findByRole('dialog', { name: '申请发布知识库' })
  expect(within(dialog).queryByRole('combobox')).toBeNull()
  expect((within(dialog).getByRole('button', { name: '提交审核' }) as HTMLButtonElement).disabled).toBe(false)
})

it.each(['public', 'subscription'] as const)('keeps both entries for a published %s library and follows the selected group in the header', async (scope) => {
  const service = api()
  service.list = vi.fn(async () => [{ id: 1, name: '已发布资料', description: '共用同一份资料', kind: 'personal' as const,
    owner_user_id: 7, owned_by_viewer: true, owner_username: '小王', operations_edition: true, publication_scope: scope }])
  render(<KnowledgePage api={service} />)
  const personal = (await screen.findByText('个人知识库')).closest('.dsh-knowledge-group') as HTMLElement
  expect(within(personal).getByRole('button', { name: '已发布资料' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: scope === 'public' ? '展开公共知识库' : '展开订阅知识库' }))
  const shared = screen.getByText(scope === 'public' ? '公共知识库' : '订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  const sharedEntry = within(shared).getByRole('button', { name: '已发布资料' })
  const personalEntry = within(personal).getByRole('button', { name: '已发布资料', current: true })
  expect(within(personalEntry).getByText('小王')).toBeTruthy()
  expect(within(sharedEntry).getByText('万维')).toBeTruthy()
  const cover = screen.getByRole('heading', { name: '已发布资料' }).closest('header')?.querySelector('.dsh-knowledge-cover')
  expect(cover?.getAttribute('data-library-group')).toBe('personal')
  fireEvent.click(sharedEntry)
  expect(cover?.getAttribute('data-library-group')).toBe(scope)
  expect(sharedEntry.getAttribute('aria-current')).toBe('true')
  expect(personalEntry.hasAttribute('aria-current')).toBe(false)
  fireEvent.click(personalEntry)
  expect(cover?.getAttribute('data-library-group')).toBe('personal')
  expect(screen.getByRole('button', { name: '上传文档' })).toBeTruthy()
})

it('keeps a public personal-origin library read-only for other viewers', async () => {
  const service = api()
  service.list = vi.fn(async () => [{ id: 1, name: '他人发布', description: '', kind: 'personal' as const,
    owner_user_id: 7, owned_by_viewer: false, publication_scope: 'public' as const }])
  render(<KnowledgePage api={service} />)
  await screen.findByRole('heading', { name: '他人发布' })
  expect(screen.queryByRole('button', { name: '上传文档' })).toBeNull()
  expect(screen.queryByText('发布')).toBeNull()
})

it('uploads into the current directory and keeps root files outside it', async () => {
  const service = api()
  service.folders = vi.fn(async () => ['资料', '资料/空目录'])
  const files = [{ id: 'root', name: '根目录.txt', size: 32, run: 'DONE', progress: 1 }]
  service.documents = vi.fn(async () => [...files])
  service.upload = vi.fn(async (_id, file, directory) => {
    files.push({ id: file.name, name: `${directory}/${file.name}`, size: file.size, run: 'DONE', progress: 1 })
  })
  const view = render(<KnowledgePage api={service} />)
  await screen.findByText('根目录.txt')
  fireEvent.click(await screen.findByRole('button', { name: /^资料/ }))
  expect(screen.queryByText('根目录.txt')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^空目录/ }))
  expect(screen.getByText('暂无内容')).toBeTruthy()
  const file = new File(['data'], '材料.txt')
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  await waitFor(() => expect(service.upload).toHaveBeenCalledWith(1, file, '资料/空目录'))
  expect(await screen.findByText('材料.txt')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: '文件路径' }).textContent).toContain('空目录')
  fireEvent.click(screen.getByRole('button', { name: '全部文件' }))
  expect(screen.getByText('根目录.txt')).toBeTruthy()
  expect(screen.queryByText('材料.txt')).toBeNull()
})

it('separates folder navigation from file previews in the current directory', async () => {
  const service = api()
  service.folders = vi.fn(async () => ['资料目录'])
  render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const folders = await screen.findByRole('region', { name: '文件夹' })
  const files = screen.getByRole('region', { name: '文件' })
  expect(within(folders).getByRole('button', { name: /^资料目录/ })).toBeTruthy()
  expect(within(folders).queryByText('说明.pdf')).toBeNull()
  expect(within(files).getByText('说明.pdf')).toBeTruthy()
  expect(within(files).queryByText('资料目录')).toBeNull()
  expect(folders.nextElementSibling).toBe(files)
  fireEvent.click(within(folders).getByRole('button', { name: /^资料目录/ }))
  expect(screen.queryByRole('region', { name: '文件夹' })).toBeNull()
  expect(screen.queryByRole('region', { name: '文件' })).toBeNull()
  expect(screen.getByText('暂无内容')).toBeTruthy()
})

it('opens the shared folder dialog from blank-space context menus in the current directory', async () => {
  const service = api()
  service.folders = vi.fn(async () => ['资料'])
  const view = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const pane = view.container.querySelector('.dsh-knowledge-list-pane') as HTMLElement
  fireEvent.contextMenu(pane, { clientX: 120, clientY: 160 })
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['新建文件夹'])
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: /^资料/ }))
  fireEvent.contextMenu(screen.getByText('暂无内容'), { clientX: 120, clientY: 160 })
  fireEvent.click(screen.getByRole('menuitem', { name: '新建文件夹' }))
  expect(screen.queryByRole('menu')).toBeNull()
  const dialog = screen.getByRole('dialog', { name: '新建文件夹' })
  fireEvent.change(within(dialog).getByLabelText('文件夹名称'), { target: { value: '子目录' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '确定' }))
  await waitFor(() => expect(service.createFolder).toHaveBeenCalledWith(1, '资料/子目录'))
  expect(await screen.findByRole('button', { name: /^子目录/ })).toBeTruthy()
})

it('keeps blank-space folder creation unavailable for public libraries and off folder cards', async () => {
  const service = api()
  service.folders = vi.fn(async () => ['资料'])
  const view = render(<KnowledgePage api={service} />)
  const card = await screen.findByRole('button', { name: /^资料/ })
  fireEvent.contextMenu(card)
  expect(screen.queryByRole('menu')).toBeNull()
  view.unmount()
  service.list = vi.fn(async () => [{ id: 2, name: '公开资料', kind: 'common' as const, description: '', owner_user_id: 1 }])
  const publicView = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.contextMenu(publicView.container.querySelector('.dsh-knowledge-list-pane')!)
  expect(screen.queryByRole('menu')).toBeNull()
})

it('does not offer blank-space folder creation in subscribed libraries', async () => {
  const service = api()
  service.categories = vi.fn(async () => [{ id: 6, name: '授权分类', type: 'common' as const, require_auth: true }])
  service.list = vi.fn(async () => [{
    id: 3, name: '订阅资料', description: '', kind: 'common' as const, category_id: 6,
    owner_user_id: 2, subscribed_by_viewer: true,
  }])
  const view = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  fireEvent.contextMenu(view.container.querySelector('.dsh-knowledge-list-pane')!)
  expect(screen.queryByRole('menuitem', { name: '新建文件夹' })).toBeNull()
  expect(service.createFolder).not.toHaveBeenCalled()
})

it('sets prices before submitting the first subscription publication', async () => {
  const service = api()
  service.publication = vi.fn(async () => ({ enabled: true, application: null }))
  service.creditPrice = vi.fn(async () => ({ enabled: true, applies: false, configured: false, preview_free: false, platform_percent: 30,
    price: { browse_cents: 0, question_cents: 0, download_cents: 0 } }))
  service.saveCreditPrice = vi.fn<KnowledgeApi['saveCreditPrice']>().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue(undefined)
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByText('发布'))
  fireEvent.click(screen.getByRole('button', { name: /转为订阅知识库/ }))
  const pricing = await screen.findByRole('dialog', { name: '知识库积分设置' })
  expect(within(pricing).getByText('平台 30% · 维护者 70%')).toBeTruthy()
  fireEvent.change(within(pricing).getByLabelText(/^浏览积分／文件/), { target: { value: '1.01' } })
  fireEvent.change(within(pricing).getByLabelText(/^问答积分／溯源文件/), { target: { value: '2' } })
  fireEvent.change(within(pricing).getByLabelText(/^下载积分／文件/), { target: { value: '3.50' } })
  fireEvent.click(within(pricing).getByRole('button', { name: '保存' }))
  expect((await within(pricing).findByRole('alert')).textContent).toContain('保存失败')
  expect(screen.getByRole('heading', { name: '我的资料' })).toBeTruthy()
  fireEvent.click(within(pricing).getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('dialog', { name: '申请发布知识库' })).toBeTruthy()
  expect(service.saveCreditPrice).toHaveBeenCalledWith(1, { browse_cents: 101, question_cents: 200, download_cents: 350 })
  expect(service.applyPublication).not.toHaveBeenCalled()
})
