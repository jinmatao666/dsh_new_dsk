// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMeetingTaskService } from '../src/client/meeting-task.ts'

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

describe('meeting minutes execution', () => {
  it('archives a dedicated session and completes only with a real Word file', async () => {
    const invoke = vi.fn(async (command: string) => command === 'list_marketplace_skills' ? [{ slug: 'office-meeting-minutes' }] : command === 'create_expert_task_directory' ? 'C:\\meeting\\task' : command === 'import_workspace_files' ? ['录音.mp3', '议程.docx'] : ['C:\\meeting\\内部转写.txt', 'C:\\meeting\\会议纪要.docx'])
    Object.assign(window, { __ZJUGIS_NATIVE_INVOKE__: invoke })
    const archiveSession = vi.fn(async () => ({ result: { ok: true, value: {} } }))
    const prompt = vi.fn(async () => ({ result: { ok: true, value: {} } }))
    const connection = {
      rpc: { call: vi.fn(async () => ({ ok: true, value: { state: 'authenticated', username: 'meeting-user' } })) },
      api: { sessions: {
        create: vi.fn(async () => ({ result: { ok: true, value: { sessionId: 'meeting-session' } } })), prompt,
        history: vi.fn(async () => ({ result: { ok: true, value: { events: [
          { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '纪要已经生成。' }] } } } },
          { event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } },
        ] } } })),
      }, workspace: { archiveSession } },
    }
    const workspaces = { list: { getSnapshot: () => ({ recentWorkspaceId: 'recent', items: [{ workspaceId: 'recent', path: 'C:\\meeting' }] }) }, createDirectory: vi.fn(async () => 'C:\\meeting\\task'), pickDirectory: vi.fn(), openPath: vi.fn() }
    const service = createMeetingTaskService(connection as never, workspaces as never)
    expect(await service.chooseDirectory('项目周会')).toBe('C:\\meeting\\task')
    const audio = { name: '录音.mp3', size: 5, arrayBuffer: async () => new Uint8Array([1]).buffer } as File
    const material = { name: '议程.docx', size: 8, arrayBuffer: async () => new Uint8Array([2]).buffer } as File
    const task = await service.start({ name: '项目周会', files: [audio, material], directory: 'C:\\meeting\\task' })
    expect(archiveSession).toHaveBeenCalledWith({ sessionId: 'meeting-session' })
    expect((prompt.mock.calls as unknown as [[{ content:{ text:string }[] }]])[0][0].content[0]!.text).toContain('/office-meeting-minutes')
    expect((prompt.mock.calls as unknown as [[{ content:{ text:string }[] }]])[0][0].content[0]!.text).toContain('只向用户交付本次实际生成的一个 Word')
    const result = await service.read(task)
    expect(result).toMatchObject({ status: 'completed', wordPath: 'C:\\meeting\\会议纪要.docx' })
    expect(result.wordPath).not.toContain('转写')
    expect((await service.list())[0]?.inputs).toHaveLength(2)
  })

  it('does not report success when the session ends without Word', async () => {
    Object.assign(window, { __ZJUGIS_NATIVE_INVOKE__: vi.fn(async () => ['C:\\meeting\\内部转写.txt']) })
    const connection = { rpc: { call: vi.fn(async () => ({ ok: true, value: { state: 'authenticated', username: 'user' } })) }, api: { sessions: { history: vi.fn(async () => ({ result: { ok: true, value: { events: [{ event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } }] } } })) } } }
    const service = createMeetingTaskService(connection as never, { openPath: vi.fn() } as never)
    const task = { id: '1', sessionId: 's', name: '会议', directory: 'C:\\meeting', createdAt: 1, inputs: [] } as never
    expect(await service.read(task)).toMatchObject({ status: 'failed', error: expect.stringContaining('没有找到会议纪要 Word') })
  })
})
