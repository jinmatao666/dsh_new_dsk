import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { RUN_INSTRUCTIONS, verifyOutputFiles, workspaceEvidence } from '../src/run-protocol.ts'

it('records generic task boundaries, prerequisites, real paths and continuation instructions', async () => {
  await expect(RUN_INSTRUCTIONS).toMatchFileSnapshot('./expected/run-instructions.txt')
})

it('opens a real DOCX through the shipped parser and rejects corrupt documents and missing validators', async () => {
  const root = await mkdtemp(join(tmpdir(), 'automation-format-'))
  try {
    const encoded = await readFile(new URL('./fixtures/verified-report.docx.b64', import.meta.url), 'utf8')
    await writeFile(join(root, 'report.docx'), Buffer.from(encoded.trim(), 'base64'))
    await writeFile(join(root, 'broken.docx'), 'not a Word document')
    const check = { documentTool: resolve('products/wanwei-desktop/scripts/document-tool.mjs'), timeoutMs: 10000 }
    expect(await verifyOutputFiles(root, ['report.docx'], check)).toHaveLength(1)
    await expect(verifyOutputFiles(root, ['broken.docx'], check)).rejects.toThrow()
    await expect(verifyOutputFiles(root, ['report.docx'])).rejects.toThrow('缺少文档格式校验器')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('returns factual empty-folder evidence without deciding whether a task needs files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'automation-evidence-'))
  try {
    expect(await workspaceEvidence(root)).toContain('顶层共有 0 个条目')
    await mkdir(join(root, '.automation-progress'))
    expect(await workspaceEvidence(root)).toContain('顶层共有 0 个条目')
    await mkdir(join(root, 'inputs'))
    expect(await workspaceEvidence(root)).toContain('"name":"inputs","directory":true')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('accepts real readable outputs but rejects missing, empty, directory and outside-workspace paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'automation-output-'))
  try {
    const cwd = join(root, 'work')
    await mkdir(cwd)
    await writeFile(join(cwd, 'final.txt'), 'verified output')
    await writeFile(join(cwd, 'empty.txt'), '')
    await writeFile(join(root, 'outside.txt'), 'not a task output')
    expect(await verifyOutputFiles(cwd, ['final.txt', './final.txt'])).toHaveLength(1)
    await expect(verifyOutputFiles(cwd, ['missing.txt'])).rejects.toThrow()
    await expect(verifyOutputFiles(cwd, ['empty.txt'])).rejects.toThrow('为空')
    await expect(verifyOutputFiles(cwd, ['.'])).rejects.toThrow('不是普通文件')
    await expect(verifyOutputFiles(cwd, ['../outside.txt'])).rejects.toThrow('必须位于')
    await expect(verifyOutputFiles(cwd, [' '])).rejects.toThrow('不能为空')
    await expect(verifyOutputFiles(cwd, ['final.txt'], { signal: AbortSignal.abort(new Error('任务已停止')) }))
      .rejects.toThrow('任务已停止')
  } finally { await rm(root, { recursive: true, force: true }) }
})
