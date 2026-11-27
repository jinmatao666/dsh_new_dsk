import { useEffect, useState } from 'react'

type Sheet = { name: string; rows: string[][] }
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function columnName(index: number): string {
  let name = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = (alphabet[(value - 1) % 26] ?? '') + name
  }
  return name
}

/** Preview worksheet values and switch between sheets. */
export function SpreadsheetPreview({ content }: { content: string }) {
  const [sheets, setSheets] = useState<Sheet[]>()
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState(false)
  useEffect(() => {
    let live = true
    void import('xlsx').then((xlsx) => {
      if (!live) return
      const workbook = xlsx.read(content, { type: 'base64', sheetRows: 501 })
      setSheets(workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name]
        const range = xlsx.utils.decode_range(sheet?.['!ref'] ?? 'A1')
        range.e.r = Math.min(range.e.r, range.s.r + 499)
        range.e.c = Math.min(range.e.c, range.s.c + 49)
        const values = xlsx.utils.sheet_to_json<string[]>(sheet ?? {}, { header: 1, raw: false, defval: '', range })
        return { name, rows: values }
      }))
    }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [content])
  if (error) return <p role="alert">无法读取此工作簿</p>
  if (!sheets) return <p role="status">正在读取工作簿…</p>
  const active = sheets[selected]
  if (!active) return <p>工作簿没有可预览的工作表</p>
  const columns = Math.max(1, ...active.rows.map(row => row.length))
  return <>
    <label className="buddy-worksheet-selector">工作表 <select value={selected} onChange={event => setSelected(Number(event.target.value))}>
      {sheets.map((sheet, index) => <option key={sheet.name} value={index}>{sheet.name}</option>)}
    </select></label>
    <table className="buddy-worksheet">
      <thead><tr><th scope="col">#</th>{Array.from({ length: columns }, (_, i) => <th scope="col" key={i}>{columnName(i)}</th>)}</tr></thead>
      <tbody>{active.rows.slice(0, 500).map((row, index) => <tr key={index}><th scope="row">{index + 1}</th>
        {Array.from({ length: columns }, (_, col) => <td key={col}>{row[col]}</td>)}</tr>)}</tbody>
    </table>
    <p className="buddy-worksheet-selector">每张工作表最多预览 500 行、50 列</p>
  </>
}
