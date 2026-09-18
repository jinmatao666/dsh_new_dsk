/**
 * Bundled, cross-platform document text extraction for the desktop sidecar.
 *
 * It deliberately has no Python dependency.  The agent invokes it through
 * DSH_NODE_BINARY/DSH_DOCUMENT_TOOL, which point to files shipped with the
 * installed application rather than to an arbitrary interpreter on the PC.
 */
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mammoth = require('mammoth')
const XLSX = require('xlsx')
const DEFAULT_MAX_CHARS = 1_500_000

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function numberArgument(name, fallback) {
  const value = Number(argument(name))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function write(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
  process.exitCode = exitCode
}

function clip(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false }
  return {
    text: `${text.slice(0, maxChars)}\n\n[内容因长度限制已截断]`,
    truncated: true,
  }
}

async function extractPdf(file, maxChars) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(file))
  const task = pdfjs.getDocument({
    data,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  })
  const pdf = await task.promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = content.items
      .map(item => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
      .trim()
    pages.push(`--- 第 ${pageNumber} 页 ---\n${pageText}`)
  }
  await pdf.destroy()
  const result = clip(pages.join('\n\n'), maxChars)
  return {
    type: 'pdf',
    text: result.text,
    metadata: { pages: pdf.numPages },
    warnings: [
      ...(result.truncated ? ['提取文本已截断'] : []),
      ...(pages.every(page => /^--- 第 \d+ 页 ---\s*$/.test(page))
        ? ['此 PDF 没有可提取文字，可能是扫描件；请改用视觉/OCR 工具。']
        : []),
    ],
  }
}

async function extractDocx(file, maxChars) {
  const result = await mammoth.extractRawText({ path: file })
  const clipped = clip(result.value.trim(), maxChars)
  return {
    type: 'docx',
    text: clipped.text,
    metadata: {},
    warnings: [
      ...result.messages.map(message => message.message),
      ...(clipped.truncated ? ['提取文本已截断'] : []),
    ],
  }
}

async function extractXlsx(file, maxChars) {
  const workbook = XLSX.readFile(file, { cellFormula: false, cellHTML: false, cellText: true })
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    return `--- 工作表：${name} ---\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`
  })
  const result = clip(sheets.join('\n\n'), maxChars)
  return {
    type: 'xlsx',
    text: result.text,
    metadata: { sheets: workbook.SheetNames },
    warnings: result.truncated ? ['提取文本已截断'] : [],
  }
}

async function main() {
  const command = process.argv[2]
  if (command === 'doctor') {
    // Load every parser here, so release CI catches an incomplete staged
    // dependency tree before we produce a desktop installer.
    await import('pdfjs-dist/legacy/build/pdf.mjs')
    write({ ok: true, version: 1, capabilities: ['pdf', 'docx', 'xlsx'] })
    return
  }
  if (command !== 'extract') {
    throw new Error('用法：document-tool.mjs doctor | extract --file <路径> [--max-chars <数量>]')
  }
  const suppliedFile = argument('--file')
  if (!suppliedFile) throw new Error('缺少 --file 参数')
  const file = resolve(suppliedFile)
  const extension = extname(file).toLowerCase()
  const maxChars = numberArgument('--max-chars', DEFAULT_MAX_CHARS)
  let result
  if (extension === '.pdf') result = await extractPdf(file, maxChars)
  else if (extension === '.docx') result = await extractDocx(file, maxChars)
  else if (extension === '.xlsx') result = await extractXlsx(file, maxChars)
  else throw new Error(`暂不支持 ${extension || '无扩展名'} 文件；支持 PDF、DOCX、XLSX。`)
  write({ ok: true, file, ...result })
}

main().catch(error => write({ ok: false, error: error instanceof Error ? error.message : String(error) }, 1))
