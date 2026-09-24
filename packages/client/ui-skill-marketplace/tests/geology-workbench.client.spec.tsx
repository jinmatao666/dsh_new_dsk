// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { GeologyWorkbench } from '../src/client/GeologyWorkbench.tsx'
import type { GeologyTask, GeologyTaskService } from '../src/client/geology-task.ts'

afterEach(cleanup)

describe('geology expert workbench', () => {
  it('keeps history and files honest before a real expert task exists', () => {
    render(<GeologyWorkbench />)
    fireEvent.click(screen.getByRole('button', { name: /我的分析记录/ }))
    expect(screen.getByRole('heading', { name: '暂无分析记录' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /我的成果文件/ }))
    expect(screen.getByText('完成分析后，Word 报告与 Excel 明细会保存在这里。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建分析' }))
    expect(screen.getByText('从项目范围开始')).toBeTruthy()
  })

  it('validates source files and refuses submission without an execution service', async () => {
    render(<GeologyWorkbench />)
    fireEvent.click(within(document.querySelector('main') as HTMLElement).getByRole('button', { name: '＋ 新建分析' }))
    fireEvent.click(screen.getByRole('button', { name: /核对分析信息/ }))
    expect(screen.getByRole('alert').textContent).toContain('请选择地块范围文件')

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['{}'], '地块.geojson', { type: 'application/geo+json' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /核对分析信息/ }))
    expect(screen.getByText('确认本次分析')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    expect((await screen.findByRole('alert')).textContent).toContain('没有连接专家执行服务')
  })

  it('shows the actual completed answer and files from a submitted task', async () => {
    const task = { id: 'task-1', sessionId: 'session-1', name: '东侧地块', directory: 'C:\\analysis\\task-1', createdAt: 1 } as GeologyTask
    const openFile = vi.fn(async () => undefined)
    const readAnalysisView = vi.fn(async () => JSON.stringify({ title: '真实地质分析', tables: [
      { id: 'overview', title: '地质条件', columns: ['分区', '条件', '面积'], rows: [['东区', '稳定', 0.1672]] },
      { id: 'risk', title: '灾害易发性', columns: ['分区', '易发性'], rows: [['东区', '低']] },
    ] }))
    const service: GeologyTaskService = {
      list: async () => [],
      start: async () => task,
      read: async () => ({ task, status: 'completed', answer: '## 综合结论\n**范围材料**已完成核查。', files: ['C:\\analysis\\task-1\\报告.docx', 'C:\\analysis\\task-1\\明细.xlsx'], analysisViewPath: 'C:\\analysis\\task-1\\地块-地质-analysis-view_20260923_120000_000.json' }),
      wait: async (_task, onUpdate) => {
        const result = await service.read(task)
        onUpdate(result)
        return result
      },
      openFile,
      readAnalysisView,
    }
    render(<GeologyWorkbench service={service} />)
    fireEvent.click(within(document.querySelector('main') as HTMLElement).getByRole('button', { name: '＋ 新建分析' }))
    fireEvent.change(screen.getByPlaceholderText('例如：东侧地块地质条件分析'), { target: { value: '东侧地块' } })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['{}'], '范围.geojson')] } })
    fireEvent.click(screen.getByRole('button', { name: /核对分析信息/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
    expect(await screen.findByText('分析已完成')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '综合结论' })).toBeTruthy()
    expect(screen.getByText('范围材料已完成核查。')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: '真实地质分析' })).toBeTruthy()
    expect(screen.getByText('稳定')).toBeTruthy()
    expect(screen.getByText('0.1672')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '灾害易发性' }))
    expect(screen.getByText('低')).toBeTruthy()
    expect(readAnalysisView).toHaveBeenCalledWith('C:\\analysis\\task-1\\地块-地质-analysis-view_20260923_120000_000.json')
    fireEvent.click(screen.getByRole('button', { name: /报告.docx/ }))
    expect(openFile).toHaveBeenCalledWith('C:\\analysis\\task-1\\报告.docx')
  })

  it('reads history status and shows only files actually found for that task', async () => {
    const task = { id: 'task-2', sessionId: 'session-2', name: '西侧地块', directory: 'C:\\analysis\\task-2', createdAt: 2 } as GeologyTask
    const service: GeologyTaskService = {
      list: async () => [task],
      start: vi.fn(),
      read: async () => ({ task, status: 'failed', answer: '输入文件缺少坐标信息。', files: [], error: '分析未正常完成，请查看上方模型回答。' }),
      wait: vi.fn(),
      openFile: vi.fn(),
      readAnalysisView: vi.fn(),
    }
    render(<GeologyWorkbench service={service} />)
    fireEvent.click(screen.getByRole('button', { name: /我的分析记录/ }))
    expect(await screen.findByText('未完成')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /西侧地块/ }))
    expect(await screen.findByText('输入文件缺少坐标信息。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /报告.docx|明细.xlsx/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /我的成果文件/ }))
    expect(await screen.findByText('暂无成果文件')).toBeTruthy()
  })
})
