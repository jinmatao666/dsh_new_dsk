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

function Write-AnalysisMarkdown([string]$path, $sourceInfo, [string]$resultPath, $response, [string]$responseParseError) {
    $lines = [System.Collections.Generic.List[string]]::new()
    [void]$lines.Add('# Land-use plan review result')
    [void]$lines.Add('')
    [void]$lines.Add('## Input inspection')
    [void]$lines.Add("- Source type: $($sourceInfo.SourceKind)")
    [void]$lines.Add(("- Source path: {0}" -f $sourceInfo.SourcePath))
    [void]$lines.Add("- Polygon features: $($sourceInfo.FeatureCount)")
    [void]$lines.Add("- Coordinate rings: $($sourceInfo.Rings.Count)")
    [void]$lines.Add("- Coordinate reference: $($sourceInfo.CoordinateSystem)")
    if ($sourceInfo.AttributeFields.Count -gt 0) { [void]$lines.Add("- Attribute fields: $($sourceInfo.AttributeFields -join ', ')") }
    [void]$lines.Add('')
    [void]$lines.Add('## GIS service response summary')
    if ($null -eq $response) {
        [void]$lines.Add('- Response JSON parsing failed. The raw service response was retained unchanged for inspection.')
        [void]$lines.Add("- Parser message: $responseParseError")
    } else {
        foreach ($property in $response.psobject.Properties) {
            $value = $property.Value
            if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) { [void]$lines.Add(("- {0}: array, records {1}" -f $property.Name, @($value).Count)) }
            elseif ($value -is [pscustomobject]) { [void]$lines.Add(("- {0}: object, fields {1}" -f $property.Name, ($value.psobject.Properties.Name -join ', '))) }
            else { [void]$lines.Add(("- {0}: {1}" -f $property.Name, $value)) }
        }
    }
    [void]$lines.Add('')
    [void]$lines.Add('## Deliverables')
    [void]$lines.Add("- Raw interface response: [JSON]($([System.IO.Path]::GetFileName($resultPath)))")
    [void]$lines.Add('- This report lists only actual response fields and record counts. Confirm business meanings against the GIS service field dictionary.')
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
Write-Output "Generated result: $target"
Write-Output "Generated report: $report"
} finally {
    if ($null -ne $resolved -and $null -ne $resolved.TemporaryDirectory -and [System.IO.Directory]::Exists($resolved.TemporaryDirectory)) { Remove-Item -LiteralPath $resolved.TemporaryDirectory -Recurse -Force }
}
