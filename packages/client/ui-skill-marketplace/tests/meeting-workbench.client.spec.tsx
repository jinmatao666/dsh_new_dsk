// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MeetingMinutesWorkbench } from '../src/client/MeetingMinutesWorkbench.tsx'
import type { MeetingTask, MeetingTaskService } from '../src/client/meeting-task.ts'

afterEach(cleanup)

describe('meeting minutes workbench', () => {
  it('rejects empty, unsupported, and multiple audio inputs', () => {
    render(<MeetingMinutesWorkbench />)
    fireEvent.click(screen.getAllByRole('button', { name: /新建纪要/ })[0] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: '核对纪要信息' }))
    expect(screen.getByRole('alert').textContent).toContain('请添加一份录音')
    const audio = document.querySelector('input[accept=".wav,.m4a,.mp3"]') as HTMLInputElement
    fireEvent.change(audio, { target: { files: [new File(['a'], '第一段.mp3')] } })
    fireEvent.change(audio, { target: { files: [new File(['b'], '第二段.wav')] } })
    expect(screen.getByText('第二段.wav')).toBeTruthy()
    expect(screen.queryByText('第一段.mp3')).toBeNull()
  })

  it('accepts text-only materials and opens the real Word result', async () => {
    const task = { id: 'm1', sessionId: 's1', name: '项目周会', directory: 'C:\\meeting\\m1', createdAt: 1, inputs: [{ name: '记录.md', size: 10, kind: 'material' as const }] } as unknown as MeetingTask
    const openFile = vi.fn(async () => undefined)
    const service: MeetingTaskService = {
      list: async () => [], chooseDirectory: async () => task.directory, start: async () => task,
      read: async () => ({ task, status: 'completed', answer: '## 核心结论\n- 按材料形成纪要', wordPath: 'C:\\meeting\\m1\\会议纪要.docx' }),
      wait: async (_task, onUpdate) => { const result = await service.read(task); onUpdate(result); return result }, openFile,
    }
    render(<MeetingMinutesWorkbench service={service} />)
    fireEvent.click(screen.getAllByRole('button', { name: /新建纪要/ })[0] as HTMLElement)
    const material = document.querySelector('input[accept*=".txt"]') as HTMLInputElement
    fireEvent.change(material, { target: { files: [new File(['notes'], '记录.md')] } })
    fireEvent.click(screen.getByRole('button', { name: '核对纪要信息' }))
    expect(await screen.findByText(task.directory)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始生成纪要' }))
    expect(await screen.findByText('会议纪要已生成')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '核心结论' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开会议纪要' }))
    expect(openFile).toHaveBeenCalledWith('C:\\meeting\\m1\\会议纪要.docx')
  })
})
