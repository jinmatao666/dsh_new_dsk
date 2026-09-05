param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$JsonPath,
    [Parameter(Mandatory = $true)][string]$MarkdownPath,
    [Parameter(Mandatory = $true)][string]$ExcelPath,
    [Parameter(Mandatory = $true)][string]$WordPath,
    [string]$ViewPath,
    [switch]$OpenWorkbook
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function XmlText([object]$value) { return [System.Security.SecurityElement]::Escape([string]$value) }

function Write-ZipPackage([string]$path, [hashtable]$entries) {
    if ([System.IO.File]::Exists($path)) { throw "输出文件已存在：$path" }
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew)
    try {
        $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($name in ($entries.Keys | Sort-Object)) {
                $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
                $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
                try { $writer.Write([string]$entries[$name]) } finally { $writer.Dispose() }
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
}

function ExcelColumn([int]$number) {
    $name = ''
    while ($number -gt 0) { $number--; $name = [char](65 + ($number % 26)) + $name; $number = [math]::Floor($number / 26) }
    return $name
}

function WorksheetXml([object[][]]$rows) {
    $xml = [System.Text.StringBuilder]::new()
    [void]$xml.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="3" width="24" customWidth="1"/><col min="4" max="4" width="70" customWidth="1"/></cols><sheetData>')
    for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex++) {
        [void]$xml.Append('<row r="' + ($rowIndex + 1) + '">')
        $row = $rows[$rowIndex]
        for ($columnIndex = 0; $columnIndex -lt $row.Count; $columnIndex++) {
            $reference = (ExcelColumn ($columnIndex + 1)) + ($rowIndex + 1)
            $style = if ($rowIndex -eq 0) { ' s="1"' } else { '' }
            [void]$xml.Append('<c r="' + $reference + '" t="inlineStr"' + $style + '><is><t xml:space="preserve">' + (XmlText $row[$columnIndex]) + '</t></is></c>')
        }
        [void]$xml.Append('</row>')
    }
    [void]$xml.Append('</sheetData><autoFilter ref="A1:D' + [math]::Max(1, $rows.Count) + '"/><sheetFormatPr defaultRowHeight="18"/></worksheet>')
    return $xml.ToString()
}

function ResponseRows($response) {
    $rows = [System.Collections.Generic.List[object[]]]::new()
    [void]$rows.Add(@('数据集', '序号', '字段', '值'))
    foreach ($property in $response.psobject.Properties) {
        $items = if ($property.Value -is [System.Collections.IEnumerable] -and $property.Value -isnot [string] -and $property.Value -isnot [System.Collections.IDictionary]) { @($property.Value) } else { @($property.Value) }
        for ($index = 0; $index -lt $items.Count; $index++) {
            $item = $items[$index]
            if ($null -ne $item -and $item.psobject.Properties.Count -gt 0 -and $item -isnot [string]) {
                foreach ($field in $item.psobject.Properties) { [void]$rows.Add(@($property.Name, ($index + 1), $field.Name, $field.Value)) }
            } else { [void]$rows.Add(@($property.Name, ($index + 1), '值', $item)) }
        }
    }
    return $rows.ToArray()
}

function ReportRows([string[]]$lines) {
    $rows = [System.Collections.Generic.List[object[]]]::new()
    [void]$rows.Add(@('章节', '内容', '', ''))
    $section = $Title
    foreach ($line in $lines) {
        if ($line.StartsWith('#')) { $section = $line.TrimStart('#').Trim(); continue }
        $text = $line.Trim().TrimStart('-', '*').Trim()
        if ($text) { [void]$rows.Add(@($section, $text, '', '')) }
    }
    return $rows.ToArray()
}

function ViewTable([string]$id, [string]$title, [object]$rows) {
    $data = [System.Collections.Generic.List[object[]]]::new()
    for ($rowIndex = 1; $rowIndex -lt $rows.Count; $rowIndex++) {
        $row = [System.Collections.Generic.List[string]]::new()
        foreach ($value in $rows[$rowIndex]) { [void]$row.Add([string]$value) }
        [void]$data.Add($row.ToArray())
    }
    return [ordered]@{
        id = $id
        title = $title
        columns = [string[]]$rows[0]
        rows = [object[]]$data.ToArray()
    }
}

function DetailViewTable($response) { $data = [System.Collections.Generic.List[object[]]]::new(); foreach ($property in $response.psobject.Properties) { $items = @($property.Value); for ($index = 0; $index -lt $items.Count; $index++) { $item = $items[$index]; if ($null -ne $item -and $item.psobject.Properties.Count -gt 0 -and $item -isnot [string]) { foreach ($field in $item.psobject.Properties) { [void]$data.Add(@($property.Name, ($index + 1), $field.Name, [string]$field.Value)) } } else { [void]$data.Add(@($property.Name, ($index + 1), '值', [string]$item)) } } }; return [ordered]@{ id = 'details'; title = '接口明细'; columns = [string[]]@('数据集', '序号', '字段', '值'); rows = [object[]]$data.ToArray() } }

function ViewSections([string[]]$lines) {
    $sections = [System.Collections.Generic.List[object]]::new(); $title = ''; $items = [System.Collections.Generic.List[string]]::new()
    $flush = { if ($title -and $items.Count -gt 0) { $kind = if ($title -match '结论|审查意见') { 'conclusion' } elseif ($title -match '建议|风险') { 'advice' } else { 'analysis' }; [void]$sections.Add([ordered]@{ title = $title; kind = $kind; items = [string[]]$items.ToArray() }) } }
    foreach ($line in $lines) { if ($line -match '^##\s+(.+)$') { & $flush; $title = $Matches[1].Trim(); $items.Clear(); continue }; if (-not $title -or $title -match '输入数据核验|原始接口返回') { continue }; $text = $line.Trim().TrimStart('-', '*').Trim(); if ($text -and -not $text.StartsWith('#') -and -not $text.StartsWith('[JSON]')) { [void]$items.Add($text) } }
    & $flush; return [object[]]$sections.ToArray()
}

function ValueOf($record, [string]$field) { $property = if ($null -eq $record) { $null } else { $record.psobject.Properties[$field] }; if ($null -eq $property -or $null -eq $property.Value) { return '—' }; return [string]$property.Value }
function RecordsOf($response, [string]$field) { $property = $response.psobject.Properties[$field]; if ($null -eq $property -or $null -eq $property.Value) { return @() }; return @($property.Value) }
function ResultRows([string]$title, $response) {
    $rows = [System.Collections.Generic.List[object[]]]::new()
    if ($title -eq '地质条件分析') { [void]$rows.Add(@('分析图层', '空间判定', '等级', '占用面积（公顷）')); foreach ($row in (RecordsOf $response 'YZT_DZHJTJ_LIST')) { [void]$rows.Add(@('地质环境条件', (ValueOf $row 'DZHJTJ'), (ValueOf $row 'DJ'), (ValueOf $row 'ZYMJ'))) }; foreach ($row in (RecordsOf $response 'YZT_DZZHYFQK_LIST')) { [void]$rows.Add(@('地质灾害易发分区', (ValueOf $row 'FQMC'), (ValueOf $row 'DJ'), (ValueOf $row 'ZYMJ'))) } }
    elseif ($title -eq '土地利用规划审查') { [void]$rows.Add(@('审查指标', '结果', '单位/说明')); foreach ($row in (RecordsOf $response 'YZT_GHSCB')) { foreach ($field in @('YDZMJ', 'SFZYJBNT', 'JBNTMJ', 'YXJSQMJ', 'YTJJSQMJ', 'XZJSQMJ', 'JZJSQMJ', 'SFZXCQFW')) { $unit = if ($field -match 'MJ$') { '公顷' } else { '服务返回代码' }; [void]$rows.Add(@($field, (ValueOf $row $field), $unit)) } } }
    else { [void]$rows.Add(@('土地利用指标', '面积（公顷）', '占项目面积比例')); foreach ($row in (RecordsOf $response 'YZT_TDFLMJB_HZB')) { $total = [double]0; [void][double]::TryParse((ValueOf $row 'HJMJ'), [ref]$total); foreach ($item in @(@('农用地', 'NYDMJ'), @('耕地', 'GDMJ'), @('建设用地', 'JSYDMJ'), @('未利用地', 'WLYDMJ'), @('永久基本农田', 'JBNTMJ'))) { $value = [double]0; [void][double]::TryParse((ValueOf $row $item[1]), [ref]$value); $ratio = if ($total -gt 0) { '{0:P2}' -f ($value / $total) } else { '—' }; [void]$rows.Add(@($item[0], (ValueOf $row $item[1]), $ratio)) } } }
    if ($rows.Count -eq 1) { [void]$rows.Add(@('未返回可展示的专项结果', '—', '—', '—')) }; return $rows.ToArray()
}

function WordParagraph([string]$line) {
    $text = $line.Trim()
    if (-not $text) { return '<w:p/>' }
    $heading = 0
    while ($heading -lt $text.Length -and $text[$heading] -eq '#') { $heading++ }
    $text = $text.TrimStart('#').Trim().TrimStart('-', '*').Trim()
    $size = if ($heading -eq 1) { 36 } elseif ($heading -eq 2) { 30 } elseif ($heading -ge 3) { 26 } else { 22 }
    $bold = if ($heading -gt 0) { '<w:b/>' } else { '' }
    return '<w:p><w:r><w:rPr>' + $bold + '<w:sz w:val="' + $size + '"/><w:szCs w:val="' + $size + '"/></w:rPr><w:t xml:space="preserve">' + (XmlText $text) + '</w:t></w:r></w:p>'
}

$markdownLines = [System.IO.File]::ReadAllLines($MarkdownPath, [System.Text.Encoding]::UTF8)
$response = [System.IO.File]::ReadAllText($JsonPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$detailRows = ResponseRows $response
$analysisRows = ReportRows $markdownLines
$resultRows = ResultRows $Title $response
$detailSheet = WorksheetXml $detailRows
$analysisSheet = WorksheetXml $analysisRows
$resultSheet = WorksheetXml $resultRows
$xlsxEntries = @{
    '[Content_Types].xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
    '_rels/.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    'xl/workbook.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="结果汇总" sheetId="1" r:id="rId1"/><sheet name="专业分析" sheetId="2" r:id="rId2"/><sheet name="接口明细" sheetId="3" r:id="rId3"/></sheets></workbook>'
    'xl/_rels/workbook.xml.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    'xl/styles.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="等线"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'
    'xl/worksheets/sheet1.xml' = $resultSheet
    'xl/worksheets/sheet2.xml' = $analysisSheet
    'xl/worksheets/sheet3.xml' = $detailSheet
}
Write-ZipPackage $ExcelPath $xlsxEntries

$body = ($markdownLines | ForEach-Object { WordParagraph $_ }) -join ''
$docxEntries = @{
    '[Content_Types].xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    '_rels/.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    'word/document.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + $body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
}
Write-ZipPackage $WordPath $docxEntries

if (-not [string]::IsNullOrWhiteSpace($ViewPath)) {
    $view = [ordered]@{
        schema_version = 1
        title = $Title
        generated_at = (Get-Date).ToString('o')
        metrics = @([ordered]@{ label = '成果表格'; value = '3 个' }, [ordered]@{ label = '接口明细'; value = "$($detailRows.Count - 1) 条" }, [ordered]@{ label = '生成时间'; value = (Get-Date).ToString('yyyy-MM-dd HH:mm') })
        sections = ViewSections $markdownLines
        tables = @((ViewTable 'summary' '结果汇总' $resultRows), (ViewTable 'analysis' '专业分析' $analysisRows), (DetailViewTable $response))
    } | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($ViewPath, $view, [System.Text.UTF8Encoding]::new($true))
}

Write-Output "已生成 Excel 分析表：$ExcelPath"
Write-Output "已生成 Word 分析报告：$WordPath"
if ($OpenWorkbook) {
    try { Start-Process -FilePath $ExcelPath | Out-Null } catch { Write-Warning "Excel 分析表已生成，但系统未能自动打开：$($_.Exception.Message)" }
}
