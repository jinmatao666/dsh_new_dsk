param(
  [Parameter(Mandatory = $true)] [string[]] $InputPaths,
  [string] $OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$supported = @('.doc', '.docx', '.docm')
$inputs = foreach ($item in $InputPaths) {
  $resolved = Resolve-Path -LiteralPath $item -ErrorAction Stop
  $file = Get-Item -LiteralPath $resolved.Path
  if ($file.PSIsContainer -or $supported -notcontains $file.Extension.ToLowerInvariant()) {
    throw "不支持的 Word 输入：$($file.FullName)"
  }
  $file
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $inputs[0].DirectoryName 'Word转PDF' }
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputRoot) | Out-Null

function New-OutputPath([string] $baseName) {
  $candidate = Join-Path $outputRoot "$baseName.pdf"
  if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
  for ($index = 2; ; $index++) {
    $candidate = Join-Path $outputRoot "$baseName-$index.pdf"
    if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
}

function Invoke-ComExport([string] $programId, [System.IO.FileInfo] $sourceFile, [string] $target) {
  $application = $null
  $document = $null
  try {
    $application = New-Object -ComObject $programId
    $application.Visible = $false
    $application.DisplayAlerts = 0
    $document = $application.Documents.Open($sourceFile.FullName, $false, $true)
    $document.ExportAsFixedFormat($target, 17)
    if (-not (Test-Path -LiteralPath $target)) { throw "$programId 未生成 PDF" }
  } finally {
    if ($document) {
      try { $document.Close($false) } catch {
        # The converter can close its document RPC server immediately after export.
      }
      try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) } catch {
        # The document COM object can already be released by the converter.
      }
    }
    if ($application) {
      try { $application.Quit() } catch {
        # The converter can close its application RPC server immediately after export.
      }
      try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application) } catch {
        # The application COM object can already be released by the converter.
      }
    }
  }
}

function Invoke-LibreOfficeExport([System.IO.FileInfo] $sourceFile, [string] $target, $soffice) {
  $temporary = Join-Path $outputRoot ('.convert-' + [guid]::NewGuid().ToString('N'))
  [System.IO.Directory]::CreateDirectory($temporary) | Out-Null
  try {
    & $soffice.Source --headless --convert-to pdf --outdir $temporary $sourceFile.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "LibreOffice 返回退出码 $LASTEXITCODE" }
    $converted = Join-Path $temporary ($sourceFile.BaseName + '.pdf')
    if (-not (Test-Path -LiteralPath $converted)) { throw 'LibreOffice 未生成 PDF' }
    Move-Item -LiteralPath $converted -Destination $target
  } finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$results = [System.Collections.Generic.List[object]]::new()
$programIds = @('Word.Application', 'Kwps.Application', 'wps.Application')
$soffice = Get-Command soffice -ErrorAction SilentlyContinue
foreach ($sourceFile in $inputs) {
  $target = New-OutputPath $sourceFile.BaseName
  $errors = [System.Collections.Generic.List[string]]::new()
  $converted = $false
  foreach ($programId in $programIds) {
    try {
      Invoke-ComExport $programId $sourceFile $target
      $converted = $true
      break
    } catch {
      $errors.Add("$programId：$($_.Exception.Message)")
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    }
  }
  if (-not $converted -and $soffice) {
    try {
      Invoke-LibreOfficeExport $sourceFile $target $soffice
      $converted = $true
    } catch {
      $errors.Add("LibreOffice：$($_.Exception.Message)")
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    }
  }
  if ($converted) {
    $results.Add([pscustomobject]@{ input = $sourceFile.FullName; output = $target; success = $true; error = $null })
  } else {
    if (-not $soffice) { $errors.Add('LibreOffice：未找到 soffice 命令') }
    $results.Add([pscustomobject]@{ input = $sourceFile.FullName; output = $null; success = $false; error = ($errors -join '；') })
  }
}

$report = Join-Path $outputRoot 'Word转PDF-处理报告.json'
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $report -Encoding utf8
$successCount = @($results | Where-Object success).Count
$artifacts = [System.Collections.Generic.List[object]]::new()
foreach ($item in $results | Where-Object success) {
  $artifacts.Add([ordered]@{ path = $item.output; kind = 'pdf'; description = "转换后的 PDF：$([System.IO.Path]::GetFileName($item.output))" })
}
$payload = [ordered]@{
  success = ($successCount -eq $results.Count)
  successCount = $successCount
  failureCount = $results.Count - $successCount
  outputDirectory = $outputRoot
  files = @($results)
  internalFiles = @($report)
  artifacts = @($artifacts)
}
Write-Output ('WANWEI_RESULT=' + ($payload | ConvertTo-Json -Compress -Depth 6))
if ($successCount -ne $results.Count) { exit 2 }
