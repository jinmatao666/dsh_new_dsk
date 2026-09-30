import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'

const productRoot = resolve(import.meta.dirname, '..')
const releaseVersion = process.env.DSH_RELEASE_VERSION?.trim() || '0.1.0'
if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/u.test(releaseVersion)) {
  throw new Error(`Invalid desktop runtime version: ${releaseVersion}`)
}
const runtimeRoot = join(productRoot, 'src-tauri', 'resources', `runtime-${releaseVersion}`)
const appRoot = join(runtimeRoot, 'app')
const binary = join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node')
const helper = join(appRoot, 'document-tool.mjs')
const result = spawnSync(binary, [helper, 'doctor'], {
  cwd: appRoot,
  encoding: 'utf8',
  windowsHide: true,
})
if (result.error || result.status !== 0) {
  throw new Error(`Staged document helper failed: ${result.error?.message || result.stderr || result.stdout}`)
}
const report = JSON.parse(result.stdout)
if (report.ok !== true || !['pdf', 'docx', 'xlsx'].every(type => report.capabilities?.includes(type))) {
  throw new Error(`Staged document helper reported incomplete capabilities: ${result.stdout}`)
}
process.stdout.write('Staged PDF, DOCX, and XLSX parsers load successfully.\n')

// Exercise a real Word document as well: loading mammoth alone did not catch
// the original packaged-runtime failure at the point users opened a DOCX.
const require = createRequire(helper)
const JSZip = require('jszip')
const verificationRoot = await mkdtemp(join(runtimeRoot, '.document-check-'))
try {
  const docx = join(verificationRoot, '文档自检.docx')
  const archive = new JSZip()
  archive.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  archive.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  archive.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>万维文档自检</w:t></w:r></w:p></w:body></w:document>')
  await writeFile(docx, await archive.generateAsync({ type: 'nodebuffer' }))
  const extraction = spawnSync(binary, [helper, 'extract', '--file', docx], {
    cwd: appRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (extraction.error || extraction.status !== 0) {
    throw new Error(`Staged DOCX extraction failed: ${extraction.error?.message || extraction.stderr || extraction.stdout}`)
  }
  const extracted = JSON.parse(extraction.stdout.trim().split(/\r?\n/u).at(-1))
  if (extracted.ok !== true || extracted.type !== 'docx' || !extracted.text.includes('万维文档自检')) {
    throw new Error(`Staged DOCX extraction returned unexpected content: ${extraction.stdout}`)
  }
  process.stdout.write('Staged DOCX text extraction passed.\n')
} finally {
  await rm(verificationRoot, { recursive: true, force: true })
}
