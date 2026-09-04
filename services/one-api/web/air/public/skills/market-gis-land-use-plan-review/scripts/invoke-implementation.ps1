param(
    [Parameter(Mandatory = $true)][Alias('GeoJsonFile')][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [int]$Blxsw = 4,
    [string]$BaseUrl = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Add-GeoJsonRings($node, [System.Collections.Generic.List[object]]$target) {
    if ($null -eq $node) { return }
    if ($node.type -eq 'FeatureCollection') { foreach ($feature in $node.features) { Add-GeoJsonRings $feature $target }; return }
    if ($node.type -eq 'Feature') { Add-GeoJsonRings $node.geometry $target; return }
    if ($node.type -eq 'Polygon') { foreach ($ring in $node.coordinates) { [void]$target.Add($ring) }; return }
    if ($node.type -eq 'MultiPolygon') { foreach ($polygon in $node.coordinates) { foreach ($ring in $polygon) { [void]$target.Add($ring) } }; return }
}

function Get-Int32BigEndian([byte[]]$bytes, [int]$offset) {
    $first = [int]$bytes[$offset]
    $second = [int]$bytes[($offset + 1)]
    $third = [int]$bytes[($offset + 2)]
    $fourth = [int]$bytes[($offset + 3)]
    return (($first -shl 24) -bor ($second -shl 16) -bor ($third -shl 8) -bor $fourth)
}

function Read-ShapefileRings([string]$shapePath) {
    $bytes = [System.IO.File]::ReadAllBytes($shapePath)
    if ($bytes.Length -lt 100) { throw "Shape file is too short: $shapePath" }
    $rings = [System.Collections.Generic.List[object]]::new()
    $featureCount = 0
    $offset = 100
    while ($offset + 12 -le $bytes.Length) {
        $length = (Get-Int32BigEndian $bytes ($offset + 4)) * 2
        $content = $offset + 8
        if ($length -lt 4 -or $content + $length -gt $bytes.Length) { throw "Invalid Shape record in $shapePath" }
        $shapeType = [BitConverter]::ToInt32($bytes, $content)
        if ($shapeType -in @(5, 15, 25)) {
            if ($length -lt 44) { throw "Invalid polygon record in $shapePath" }
            $partCount = [BitConverter]::ToInt32($bytes, $content + 36)
            $pointCount = [BitConverter]::ToInt32($bytes, $content + 40)
            if ($partCount -lt 1 -or $pointCount -lt 4) { throw "Shape polygon has no usable rings: $shapePath" }
            $partsOffset = $content + 44
            $pointsOffset = $partsOffset + (4 * $partCount)
            if ($pointsOffset + (16 * $pointCount) -gt $content + $length) { throw "Shape polygon points exceed its record: $shapePath" }
            $parts = for ($index = 0; $index -lt $partCount; $index++) { [BitConverter]::ToInt32($bytes, $partsOffset + (4 * $index)) }
            for ($partIndex = 0; $partIndex -lt $partCount; $partIndex++) {
                $start = $parts[$partIndex]
                $end = if ($partIndex + 1 -lt $partCount) { $parts[$partIndex + 1] } else { $pointCount }
                if ($start -lt 0 -or $end -gt $pointCount -or $end - $start -lt 4) { throw "Shape polygon has an invalid ring: $shapePath" }
                $ring = [System.Collections.Generic.List[object]]::new()
                for ($pointIndex = $start; $pointIndex -lt $end; $pointIndex++) {
                    $pointOffset = $pointsOffset + (16 * $pointIndex)
                    [void]$ring.Add(@([BitConverter]::ToDouble($bytes, $pointOffset), [BitConverter]::ToDouble($bytes, $pointOffset + 8)))
                }
                [void]$rings.Add($ring.ToArray())
            }
            $featureCount++
        } elseif ($shapeType -ne 0) { throw "Only Polygon Shape files are supported; found shape type $shapeType in $shapePath" }
        $offset = $content + $length
    }
    if ($rings.Count -eq 0) { throw "Shape file contains no Polygon geometry: $shapePath" }
    return [PSCustomObject]@{ Rings = $rings.ToArray(); FeatureCount = $featureCount }
}

function Read-DbfFields([string]$dbfPath) {
    $bytes = [System.IO.File]::ReadAllBytes($dbfPath)
    if ($bytes.Length -lt 33) { throw "DBF file is too short: $dbfPath" }
    $headerLength = [BitConverter]::ToInt16($bytes, 8)
    $names = [System.Collections.Generic.List[string]]::new()
    for ($offset = 32; $offset + 32 -le $headerLength; $offset += 32) {
        if ($bytes[$offset] -eq 13) { break }
        $nameBytes = $bytes[$offset..($offset + 10)] | Where-Object { $_ -ne 0 }
        $name = [System.Text.Encoding]::ASCII.GetString([byte[]]$nameBytes).Trim()
        if ($name) { [void]$names.Add($name) }
    }
    return $names.ToArray()
}

function Get-ShapeSource([string]$path) {
    $source = [System.IO.Path]::GetFullPath($path)
    $temporary = $null
    if ([System.IO.Path]::GetExtension($source).ToLowerInvariant() -eq '.zip') {
        if (-not [System.IO.File]::Exists($source)) { throw "Shape ZIP file not found: $source" }
        $temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-gis-" + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($temporary) | Out-Null
        $archive = [System.IO.Compression.ZipFile]::OpenRead($source)
        try {
            foreach ($entry in $archive.Entries) {
                $name = $entry.FullName.Replace('\', '/')
                if ($name.StartsWith('/') -or $name.Contains('../') -or $name.Contains(':')) { throw "Unsafe ZIP entry: $($entry.FullName)" }
            }
        } finally { $archive.Dispose() }
        [System.IO.Compression.ZipFile]::ExtractToDirectory($source, $temporary)
        $root = $temporary
    } elseif ([System.IO.Directory]::Exists($source)) {
        $root = $source
    } elseif ([System.IO.Path]::GetExtension($source).ToLowerInvariant() -eq '.shp' -and [System.IO.File]::Exists($source)) {
        $root = Split-Path -Parent $source
    } else { throw "Expected a GeoJSON file, Polygon .shp file, Shape ZIP, or directory: $source" }
    $shapes = Get-ChildItem -LiteralPath $root -Filter '*.shp' -File -Recurse
    if ($shapes.Count -ne 1) { throw "Expected exactly one .shp file in the supplied Shape source; found $($shapes.Count)." }
    $shape = $shapes[0]
    $base = [System.IO.Path]::Combine($shape.DirectoryName, [System.IO.Path]::GetFileNameWithoutExtension($shape.Name))
    foreach ($extension in @('.shx', '.dbf')) { if (-not [System.IO.File]::Exists("$base$extension")) { throw "Shape package is missing $extension beside $($shape.Name)" } }
    $geometry = Read-ShapefileRings $shape.FullName
    $prjPath = "$base.prj"
    return [PSCustomObject]@{
        SourcePath = $source; SourceKind = if ($temporary) { 'Shape ZIP' } elseif ([System.IO.Directory]::Exists($source)) { 'Shape directory' } else { 'Shape file' }
        Rings = $geometry.Rings; FeatureCount = $geometry.FeatureCount; CoordinateSystem = if ([System.IO.File]::Exists($prjPath)) { [System.IO.File]::ReadAllText($prjPath).Trim() } else { '.prj file was not provided' }
        AttributeFields = Read-DbfFields "$base.dbf"; TemporaryDirectory = $temporary
    }
}

function Resolve-Input([string]$path) {
    $source = [System.IO.Path]::GetFullPath($path)
    $extension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
    if ($extension -in @('.geojson', '.json')) {
        if (-not [System.IO.File]::Exists($source)) { throw "GeoJSON file not found: $source" }
        $geoJson = Get-Content -LiteralPath $source -Raw -Encoding UTF8 | ConvertFrom-Json
        $rings = [System.Collections.Generic.List[object]]::new()
        Add-GeoJsonRings $geoJson $rings
        if ($rings.Count -eq 0) { throw 'GeoJSON must contain Polygon or MultiPolygon geometry.' }
        $firstFeature = if ($geoJson.type -eq 'FeatureCollection') { $geoJson.features | Select-Object -First 1 } elseif ($geoJson.type -eq 'Feature') { $geoJson } else { $null }
        return [PSCustomObject]@{ SourcePath = $source; SourceKind = 'GeoJSON'; Rings = $rings.ToArray(); FeatureCount = if ($geoJson.type -eq 'FeatureCollection') { @($geoJson.features).Count } else { 1 }; CoordinateSystem = 'GeoJSON has no embedded coordinate reference system; use user or source metadata.'; AttributeFields = if ($firstFeature) { @($firstFeature.properties.psobject.Properties.Name) } else { @() }; TemporaryDirectory = $null }
    }
    return Get-ShapeSource $source
}

function Localized([string]$value) { return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value)) }

function FieldValue($record, [string]$field) {
    $property = $record.psobject.Properties[$field]
    if ($null -eq $property -or $null -eq $property.Value) { return '-' }
    return [string]$property.Value
}

function ResponseRecords($data, [string[]]$fields) {
    foreach ($field in $fields) {
        $property = $data.psobject.Properties[$field]
        if ($null -ne $property -and $null -ne $property.Value) { return @($property.Value) }
    }
    return @()
}

function Write-AnalysisMarkdown([string]$path, $sourceInfo, [string]$resultPath, $response, [string]$responseParseError) {
    $lines = [System.Collections.Generic.List[string]]::new()
    [void]$lines.Add('# ' + (Localized '5Zyf5Zyw5Yip55So6KeE5YiS5a6h5p+l5oql5ZGK'))
    [void]$lines.Add('')
    [void]$lines.Add('## ' + (Localized '6L6T5YWl5pWw5o2u5qC46aqM'))
    [void]$lines.Add(('- {0}: {1}' -f (Localized '5pWw5o2u57G75Z6L'), $sourceInfo.SourceKind))
    [void]$lines.Add(('- {0}: {1}' -f (Localized '5pWw5o2u6Lev5b6E'), $sourceInfo.SourcePath))
    [void]$lines.Add(('- {0}: {1}' -f (Localized '6Z2i6KaB57Sg5pWw6YeP'), $sourceInfo.FeatureCount))
    [void]$lines.Add(('- {0}: {1}' -f (Localized '6L6555WM546v5pWw6YeP'), $sourceInfo.Rings.Count))
    [void]$lines.Add(('- {0}: {1}' -f (Localized '5Z2Q5qCH5Y+C6ICD'), $sourceInfo.CoordinateSystem))
    if ($sourceInfo.AttributeFields.Count -gt 0) { [void]$lines.Add(('- {0}: {1}' -f (Localized '5bGe5oCn5a2X5q61'), ($sourceInfo.AttributeFields -join ', '))) }
    [void]$lines.Add('')
    [void]$lines.Add('## ' + (Localized '5Y+v6Kej6YeK55qE5YiG5p6Q57uT5p6c'))
    if ($null -eq $response) {
        [void]$lines.Add('- ' + (Localized '5pyN5Yqh6L+U5Zue5YaF5a655LiN5piv5pyJ5pWIIEpTT07vvIzlt7Lljp/moLfkv53nlZnlnKggSlNPTiDmlofku7bkuK3vvIzml6Dms5XlronlhajnlJ/miJDmlbDlgLzliIbmnpDjgII='))
        [void]$lines.Add(('- {0}: {1}' -f (Localized '6Kej5p6Q6ZSZ6K+v'), $responseParseError))
    } else {
        $reviews = @(ResponseRecords -data $response -fields @('YZT_GHSCB'))
        $zones = @(ResponseRecords -data $response -fields @('YZT_GNQMJB_LIST'))
        if ($reviews.Count -gt 0) {
            [void]$lines.Add(('### {0} ({1})' -f (Localized '6KeE5YiS5a6h5p+l57uT5p6c'), $reviews.Count))
            foreach ($row in $reviews) {
                [void]$lines.Add(('- {0}: {1}; {2}: {3}; {4}: {5}' -f (Localized '5piv5ZCm6YeN54K55Z+O5Yy66IyD5Zu0'), (FieldValue $row 'SFZXCQFW'), (Localized '55So5Zyw5oC76Z2i56ev'), (FieldValue $row 'YDZMJ'), (Localized '5piv5ZCm5Y2g55So5rC45LmF5Z+65pys5Yac55Sw'), (FieldValue $row 'SFZYJBNT')))
                [void]$lines.Add(('  - {0}: {1}; {2}: {3}; {4}: {5}; {6}: {7}' -f (Localized '5YWB6K645bu66K6+5Yy66Z2i56ev'), (FieldValue $row 'YXJSQMJ'), (Localized '5pyJ5p2h5Lu25bu66K6+5Yy66Z2i56ev'), (FieldValue $row 'YTJJSQMJ'), (Localized '6ZmQ5Yi25bu66K6+5Yy66Z2i56ev'), (FieldValue $row 'XZJSQMJ'), (Localized '56aB5q2i5bu66K6+5Yy66Z2i56ev'), (FieldValue $row 'JZJSQMJ')))
                [void]$lines.Add(('  - {0}: {1}' -f (Localized '5Y2g55So5Z+65pys5Yac55Sw6Z2i56ev'), (FieldValue $row 'JBNTMJ')))
            }
        }
        if ($zones.Count -gt 0) {
            [void]$lines.Add(('### {0} ({1})' -f (Localized '5Yqf6IO95Yy65piO57uG'), $zones.Count))
            foreach ($row in $zones) {
                [void]$lines.Add(('- {0}: {1}; JBNTBHQMJ: {2}; JBNTMJ: {3}; SZJSYDQMJ: {4}; CZJSYDQMJ: {5}' -f (Localized '5Yqf6IO95Yy657G75Z6L'), (FieldValue $row 'GNQLX'), (FieldValue $row 'JBNTBHQMJ'), (FieldValue $row 'JBNTMJ'), (FieldValue $row 'SZJSYDQMJ'), (FieldValue $row 'CZJSYDQMJ')))
            }
        }
        if ($reviews.Count -eq 0 -and $zones.Count -eq 0) { [void]$lines.Add('- ' + (Localized '5pyq6L+U5Zue5bey56Gu6K6k55qE6KeE5YiS5a6h5p+l5a2X5q6144CC')) }
        [void]$lines.Add('')
        [void]$lines.Add('## 专业审查意见')
        [void]$lines.Add('- 审查表用于判断项目范围与规划管控要求的空间关系，功能分区明细用于解释不同管控类型的面积构成；两个数据集分别统计，不跨图层累加。')
        [void]$lines.Add('- 涉及永久基本农田、限制建设区或禁止建设区的部分，应优先核对空间位置，并在用地预审和规划许可阶段落实避让或专题论证。')
        [void]$lines.Add('- 建设用地应结合允许建设、有条件建设和现状建设分区判断可实施性，不能仅依据项目总面积作出符合性结论。')
        [void]$lines.Add('- 建议将本次空间审查结果与项目选址方案、国土空间总体规划及详细规划成果联合复核，形成可追溯的审查依据。')
    }
    [void]$lines.Add('')
    [void]$lines.Add('## ' + (Localized '5pWw5o2u6ZmQ5Yi2'))
    [void]$lines.Add('- 审查结论以本次输入范围、审查类别和 GIS 服务返回的现势规划数据为依据；各规划图层采用独立面积口径。')
    [void]$lines.Add('')
    [void]$lines.Add('## ' + (Localized '5Y6f5aeL5o6l5Y+j6L+U5Zue'))
    [void]$lines.Add(('- [JSON]({0})' -f [System.IO.Path]::GetFileName($resultPath)))
    [System.IO.File]::WriteAllLines($path, $lines, [System.Text.UTF8Encoding]::new($false))
}

$resolved = $null
try {
    $resolved = Resolve-Input $InputPath
    $outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
    [System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
    $rings = $resolved.Rings
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = $env:DSH_GIS_SERVICE_URL }
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = 'http://60.191.110.206:38010' }
$arcGeometry = @{ hasZ = $false; hasM = $false; rings = $rings } | ConvertTo-Json -Compress -Depth 100
$body = @{
    GeoJson = $arcGeometry
    IsAnaXzCoverBp = $false
    Blxsw = $Blxsw
    IsAnaGh = $true
    IsAnaGhWithCZJSKZQ = $false
} | ConvertTo-Json -Compress -Depth 100
$uri = "$($BaseUrl.TrimEnd('/'))/Analysis.svc/OneKeyAnalysis"
$response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -ContentType 'text/plain; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
$target = Join-Path $outputPath "land-use-plan-review-result_$stamp.json"
$content = if ($response.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($response.Content) } else { [string]$response.Content }
[System.IO.File]::WriteAllText($target, $content, [System.Text.UTF8Encoding]::new($false))
$responseJson = $null
$responseParseError = ''
try { $responseJson = $content | ConvertFrom-Json } catch { $responseParseError = $_.Exception.Message }
$report = Join-Path $outputPath "land-use-plan-review-report_$stamp.md"
Write-AnalysisMarkdown $report $resolved $target $responseJson $responseParseError
$workbook = Join-Path $outputPath "land-use-plan-review-table_$stamp.xlsx"
$wordReport = Join-Path $outputPath "land-use-plan-review-report_$stamp.docx"
$analysisView = Join-Path $outputPath "land-use-plan-review-view_$stamp.json"
& (Join-Path $PSScriptRoot 'export-office.ps1') -Title '土地利用规划审查' -JsonPath $target -MarkdownPath $report -ExcelPath $workbook -WordPath $wordReport -ViewPath $analysisView -OpenWorkbook
Write-Output "已生成接口原始结果：$target"
Write-Output "已生成 Markdown 分析底稿：$report"
Write-Output "已生成对话分析数据：$analysisView"
} finally {
    if ($null -ne $resolved -and $null -ne $resolved.TemporaryDirectory -and [System.IO.Directory]::Exists($resolved.TemporaryDirectory)) { Remove-Item -LiteralPath $resolved.TemporaryDirectory -Recurse -Force }
}
