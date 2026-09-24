// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLandUsePlanReviewTaskService } from '../src/client/land-use-plan-review-task.ts'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('land use plan review expert execution', () => {
  it('starts a fresh archived skill session and reads only its actual answer and output files', async () => {
    const invoke = vi.fn(async (command: string) => command === 'import_workspace_files'
      ? ['parcel.geojson']
      : command === 'list_marketplace_skills'
        ? [{ slug: 'market-gis-land-use-plan-review' }]
        : command === 'read_analysis_view'
          ? '{"title":"本次分析","tables":[]}'
          : ['C:\\analysis\\规划报告.docx', 'C:\\analysis\\规划明细.xlsx', 'C:\\analysis\\地块_土地利用规划分析视图_20260923_120000_000.json'])
    Object.assign(window, { __ZJUGIS_NATIVE_INVOKE__: invoke })
    const archiveSession = vi.fn(async () => ({ result: { ok: true, value: {} } }))
    const prompt = vi.fn(async (_input: { content: { text: string }[] }) => ({ result: { ok: true, value: {} } }))
    const history = vi.fn(async () => ({ result: { ok: true, value: { events: [
      { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '本次规划审查结论' }] } } } },
      { event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } },
    ] } } }))
    const connection = {
      rpc: { call: vi.fn(async () => ({ ok: true, value: { state: 'authenticated', username: 'tester' } })) },
      api: { sessions: {
        create: vi.fn(async () => ({ result: { ok: true, value: { sessionId: 'fresh-session' } } })),
        prompt,
        history,
      }, workspace: { archiveSession } },
    }
    const workspaces = {
      list: { getSnapshot: () => ({ recentWorkspaceId: 'recent', items: [{ workspaceId: 'recent', path: 'C:\\analysis' }] }) },
      createDirectory: vi.fn(async () => 'C:\\analysis\\new-task'),
      pickDirectory: vi.fn(),
      openPath: vi.fn(),
    }
    const service = createLandUsePlanReviewTaskService(connection as never, workspaces as never)
    const source = { name: 'parcel.geojson', arrayBuffer: async () => new Uint8Array([123, 125]).buffer } as File
    const task = await service.start({ name: '测试地块', files: [source], reviewCategory: 4, coordinateSystem: '' })
    expect(task.sessionId).toBe('fresh-session')
    expect(archiveSession).toHaveBeenCalledWith({ sessionId: 'fresh-session' })
    expect(prompt.mock.calls[0]?.[0].content[0]?.text).toContain('/market-gis-land-use-plan-review')
    expect(prompt.mock.calls[0]?.[0].content[0]?.text).toContain('审查类别 Blxsw：4')
    expect(prompt.mock.calls[0]?.[0].content[0]?.text).toContain('new-task')
    expect((await service.list()).map(item => item.id)).toEqual([task.id])
    expect(localStorage.getItem('dsh.expert.land-use-plan-review.tasks.tester')).toContain(task.id)

    const result = await service.read(task)
    expect(history).toHaveBeenCalledWith({ sessionId: 'fresh-session', maxMessages: 100 })
    expect(result).toMatchObject({ status: 'completed', answer: '本次规划审查结论' })
    expect(result.files).toHaveLength(3)
    expect(result.analysisViewPath).toContain('土地利用规划分析视图_20260923_120000_000.json')
    await service.readAnalysisView(result.analysisViewPath ?? '')
    expect(invoke).toHaveBeenCalledWith('read_analysis_view', { path: result.analysisViewPath })
    expect(invoke).toHaveBeenCalledWith('list_expert_output_files', { directory: task.directory })
  })
})
