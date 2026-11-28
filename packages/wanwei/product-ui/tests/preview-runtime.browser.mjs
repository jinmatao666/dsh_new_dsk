import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { compilePreview } from '../preview-runtime/build.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(resolve('apps/web/package.json'))('playwright')
const JSZip = require('jszip')
const XLSX = require('xlsx')
const html = await compilePreview()
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<iframe title="preview" sandbox="allow-scripts" style="width:880px;height:760px;border:0"></iframe>') })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, channel: process.env.PREVIEW_BROWSER_CHANNEL ?? 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  const load = async (content, name, mime, text) => {
    await page.goto(url)
    await page.locator('iframe').evaluate((frame, source) => { frame.srcdoc = source }, html)
    const frame = page.frameLocator('iframe')
    await frame.locator('#root').waitFor()
    await page.locator('iframe').evaluate((frame, input) => frame.contentWindow.postMessage({ type: 'buddy-preview-content', input }, '*'), { content, name, mime, text, version: name })
    return frame
  }
  const word = new JSZip()
  word.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  word.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  word.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Original Word document</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>')
  let frame = await load(await word.generateAsync({ type: 'base64' }), 'sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  await frame.getByText('Original Word document', { exact: true }).waitFor()
  assert.equal(await frame.locator('.parvis-docx-page-frame').count(), 1)
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['Merged title', ''], ['Status', 'Ready'], ['Total', 2]])
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  sheet.B3 = { t: 'n', v: 2, f: '1+1' }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Checklist')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second sheet']]), 'Second')
  frame = await load(XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' }), 'sample.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  await frame.getByText('Merged title', { exact: true }).first().waitFor()
  assert.equal(await frame.locator('td[colspan="2"]').count(), 1)
  frame = await load(XLSX.write(workbook, { type: 'base64', bookType: 'biff8' }), 'sample.xls', 'application/vnd.ms-excel')
  await frame.getByText('Merged title', { exact: true }).first().waitFor()
  assert.equal(await frame.locator('td[colspan="2"]').count(), 1)
  await frame.getByText('Second', { exact: true }).click()
  await frame.getByText('Second sheet', { exact: true }).first().waitFor()
  frame = await load(Buffer.from('地类,面积\n耕地,12.5\n林地,6.3', 'utf8').toString('base64'), 'sample.csv', 'application/vnd.ms-excel')
  await frame.getByText('耕地', { exact: true }).first().waitFor()
  frame = await load('', 'sample.md', 'text/markdown', '# Markdown heading\n\n**Strong text**')
  await frame.getByRole('heading', { name: 'Markdown heading' }).waitFor()
  frame = await load('', 'sample.html', 'text/html', '<h1>Safe HTML</h1><script>parent.postMessage({type:"unsafe"},"*")</script>')
  await frame.frameLocator('iframe').getByRole('heading', { name: 'Safe HTML' }).waitFor()
  assert.equal(await frame.frameLocator('iframe').locator('script').count(), 0)
  frame = await load('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3AAAAABJRU5ErkJggg==', 'sample.png', 'image/png')
  await frame.getByRole('button', { name: '放大', exact: true }).waitFor()
  await frame.getByRole('button', { name: '缩小', exact: true }).click()
  const ppt = new JSZip()
  ppt.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="9144000" cy="5143500"/></p:presentation>')
  for (let number = 1; number <= 2; number++) ppt.file(`ppt/slides/slide${number}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2800"/><a:t>Slide ${number}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  frame = await load(await ppt.generateAsync({ type: 'base64' }), 'sample.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  await frame.getByRole('button', { name: 'Next slide' }).waitFor()
  await frame.getByRole('button', { name: 'Next slide' }).click()
  await frame.getByText('2 / 2', { exact: true }).waitFor()
  assert.ok(await frame.locator('svg').count() >= 3)
  // Minimal real, selectable two-page PDF with a built-in font.
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const stream = 'BT /F1 18 Tf 40 450 Td (Selectable PDF text) Tj ET'
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  frame = await load(Buffer.from(pdf).toString('base64'), 'sample.pdf', 'application/pdf')
  await frame.locator('.parvis-pdf-page').first().waitFor()
  await page.waitForFunction(() => true) // Rendering is observed below inside the isolated frame.
  await frame.locator('canvas').first().evaluate(canvas => new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000
    const check = () => canvas.width > 1 ? resolve(true) : Date.now() > deadline ? reject(new Error('PDF did not render')) : setTimeout(check, 50)
    check()
  }))
  assert.equal(await frame.locator('.parvis-pdf-page').count(), 2)
  assert.deepEqual(failures, [])
  console.log('Parvis preview browser checks passed: Word, merged/multiple Excel sheets, Markdown, sanitized HTML, image zoom, PPT slides, two-page PDF.')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
