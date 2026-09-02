/** Desktop-local PDF/DOCX/XLSX extraction through the packaged Node helper. */
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'

/** Configuration for the packaged document-extraction helper. */
export interface Config {
  /** Absolute path to the packaged Node executable that runs the document helper. */
  nodeBinary?: string
  /** Absolute path to the document extraction helper module. */
  helperPath?: string
}

export const Config: z<Config> = z.object({
  nodeBinary: z.string().default(''),
  helperPath: z.string().default(''),
})

export const name = 'dsh-document-local'
export const inject = ['tools']

type ExtractionStatus = 'ok' | 'needs_vision' | 'unavailable'

interface HelperResult {
  ok?: unknown
  file?: unknown
  type?: unknown
  text?: unknown
  metadata?: unknown
  warnings?: unknown
  error?: unknown
}

interface ExtractionResult {
  status: ExtractionStatus
  file: string
  type: string
  text: string
  message: string
  warnings: string[]
}

function sourceHelperPath(): string {
  return resolve(import.meta.dirname, '../../../../apps/desktop/scripts/document-tool.mjs')
}

function helperPath(config: Config): string {
  return process.env.DSH_DOCUMENT_TOOL || config.helperPath || sourceHelperPath()
}

function nodeBinary(config: Config): string {
  return process.env.DSH_NODE_BINARY || config.nodeBinary || process.execPath
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function runHelper(
  binary: string,
  helper: string,
  filePath: string,
  maxChars: number | undefined,
  signal: AbortSignal,
): Promise<HelperResult> {
  return new Promise((resolveResult, reject) => {
    const args = [helper, 'extract', '--file', filePath]
    if (maxChars !== undefined) args.push('--max-chars', String(maxChars))
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      try {
        // Some document libraries (notably PDF.js) may write harmless warnings
        // before the JSON payload. Parse the JSON object instead of requiring
        // stdout to contain JSON and nothing else.
        const start = stdout.indexOf('{')
        const end = stdout.lastIndexOf('}')
        const payload = start >= 0 && end >= start ? stdout.slice(start, end + 1) : stdout
        const parsed = JSON.parse(payload) as HelperResult
        if (code === 0 || parsed.ok === false) return resolveResult(parsed)
      } catch {
        // Report the process failure below with the captured diagnostic.
      }
      reject(new Error(`内置文档解析器异常退出（${String(code)}）：${stderr.trim() || stdout.trim() || '无诊断信息'}`))
    })
    const abort = () => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    child.once('close', () => { signal.removeEventListener('abort', abort) })
  })
}

function present(result: ExtractionResult): string {
  const warningText = result.warnings.length === 0 ? '' : `\n<warnings>\n${result.warnings.join('\n')}\n</warnings>`
  return [
    `<document status="${result.status}" type="${result.type}" path="${result.file}">`,
    `<message>${result.message}</message>`,
    result.text === '' ? '' : `<text>\n${result.text}\n</text>`,
    warningText,
    '</document>',
  ].filter(Boolean).join('\n')
}

/** Register the packaged, dependency-free document extraction tool. */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'extract_document',
    description: 'Extract text from a local PDF, DOCX, or XLSX using the built-in desktop parser. Always use this for ordinary office documents instead of read, Python, pip, or recognize_image. For a scanned PDF with no text layer it returns needs_vision; then use configured vision/OCR and do not invent document content.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Existing local PDF, DOCX, or XLSX file path.' },
      max_chars: { type: 'integer', description: 'Optional maximum extracted character count; omit for the normal limit.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          file: { type: 'string', required: true },
          type: { type: 'string', required: true },
          text: { type: 'string', required: true },
          message: { type: 'string', required: true },
          warnings: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: present(value as ExtractionResult) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ExtractionResult> {
      const filePath = args.file_path.trim()
      if (filePath === '') throw new Error('file_path 必须是非空路径')
      const helper = helperPath(config)
      const binary = nodeBinary(config)
      if (!existsSync(helper)) {
        throw new Error(`内置文档解析器未找到：${helper}`)
      }
      const raw = await runHelper(binary, helper, filePath, args.max_chars, exec.signal)
      const file = typeof raw.file === 'string' ? raw.file : filePath
      const type = typeof raw.type === 'string' ? raw.type : 'unknown'
      const text = typeof raw.text === 'string' ? raw.text : ''
      const warnings = asStrings(raw.warnings)
      if (raw.ok !== true) {
        return {
          status: 'unavailable', file, type, text: '', warnings,
          message: typeof raw.error === 'string' ? raw.error : '文档当前不可解析。',
        }
      }
      const needsVision = text.trim() === '' && warnings.some(warning => /扫描件|没有可提取文字|OCR|vision/i.test(warning))
      return {
        status: needsVision ? 'needs_vision' : 'ok',
        file,
        type,
        text,
        warnings,
        message: needsVision
          ? '该 PDF 没有可提取的文字层，需使用已配置的视觉/OCR 能力；在识别成功前不能据此作出审查结论。'
          : '文档文本提取完成。',
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Extract document ${basename(args.file_path)}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
