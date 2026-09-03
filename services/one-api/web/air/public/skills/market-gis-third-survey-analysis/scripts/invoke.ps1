param(
    [Parameter(Mandatory = $true)][string]$GeoJsonFile,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [int]$Xznf = 2024,
    [int]$Blxsw = 4,
    [string]$BaseUrl = ''
)

$ErrorActionPreference = 'Stop'

function Get-PolygonRings($node) {
    if ($null -eq $node) { return $null }
    if ($node.type -eq 'FeatureCollection') {
        foreach ($feature in $node.features) {
            $rings = Get-PolygonRings $feature
            if ($null -ne $rings) { return $rings }
        }
        return $null
    }
    if ($node.type -eq 'Feature') { return Get-PolygonRings $node.geometry }
    if ($node.type -eq 'Polygon') { return @($node.coordinates) }
    if ($node.type -eq 'MultiPolygon') {
        $rings = @()
        foreach ($polygon in $node.coordinates) { $rings += @($polygon) }
        return $rings
    }
    return $null
}

$inputPath = [System.IO.Path]::GetFullPath($GeoJsonFile)
if (-not [System.IO.File]::Exists($inputPath)) { throw "GeoJSON file not found: $inputPath" }
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$geoJson = Get-Content -LiteralPath $inputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$rings = Get-PolygonRings $geoJson
if ($null -eq $rings -or $rings.Count -eq 0) { throw 'GeoJSON must contain a Polygon or MultiPolygon geometry.' }
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = $env:DSH_GIS_SERVICE_URL }
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = 'http://60.191.110.206:38010' }
$arcGeometry = @{ hasZ = $false; hasM = $false; rings = $rings } | ConvertTo-Json -Compress -Depth 100
$body = @{
    GeoJson = $arcGeometry
    IsAnaXzCoverBp = $false
    IsAnalysisXzDetail = $true
    Xznf = $Xznf
    Blxsw = $Blxsw
    IsAnaGh = $false
    IsAnaXz = $true
    IsSD_GD = $false
    IsAnalysisSyqxx = $false
    IsQueryGeometry = $false
    IsAnalysisTfh = $true
    IsAnalysisFGNYD = $true
    IsAnalysisJSYD09DL = $true
} | ConvertTo-Json -Compress -Depth 100
$uri = "$($BaseUrl.TrimEnd('/'))/Analysis.svc/SanDXzAnalysis"
$response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -ContentType 'text/plain; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
$target = Join-Path $outputPath "third-survey-analysis-result_$stamp.json"
[System.IO.File]::WriteAllText($target, [string]$response.Content, [System.Text.UTF8Encoding]::new($false))
Write-Output $target
