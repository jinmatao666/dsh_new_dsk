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

$results = [System.Collections.Generic.List[object]]::new()
$word = $null
try {
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
  } catch {
    $word = $null
  }

  $soffice = if (-not $word) { Get-Command soffice -ErrorAction SilentlyContinue } else { $null }
  if (-not $word -and -not $soffice) {
    throw '未找到 Microsoft Word 或 LibreOffice。请安装其中一个后重试。'
  }

  foreach ($input in $inputs) {
    $target = New-OutputPath $input.BaseName
    try {
      if ($word) {
        $document = $word.Documents.Open($input.FullName, $false, $true)
        try { $document.ExportAsFixedFormat($target, 17) } finally { $document.Close($false) }
      } else {
        $temporary = Join-Path $outputRoot ('.convert-' + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($temporary) | Out-Null
        try {
          & $soffice.Source --headless --convert-to pdf --outdir $temporary $input.FullName | Out-Null
          if ($LASTEXITCODE -ne 0) { throw "LibreOffice 返回退出码 $LASTEXITCODE" }
          $converted = Join-Path $temporary ($input.BaseName + '.pdf')
          if (-not (Test-Path -LiteralPath $converted)) { throw 'LibreOffice 未生成 PDF' }
          Move-Item -LiteralPath $converted -Destination $target
        } finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
      }
      if (-not (Test-Path -LiteralPath $target)) { throw '转换命令结束但未生成 PDF' }
      $results.Add([pscustomobject]@{ input = $input.FullName; output = $target; success = $true; error = $null })
    } catch {
      $results.Add([pscustomobject]@{ input = $input.FullName; output = $null; success = $false; error = $_.Exception.Message })
    }
  }
} finally {
  if ($word) {
  try { $word.Quit() } catch { # Word may close its RPC server immediately after export.
  }
  try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) } catch { # The COM object may already be released.
  }
}
}

$report = Join-Path $outputRoot 'Word转PDF-处理报告.json'
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $report -Encoding utf8
$successCount = @($results | Where-Object success).Count
$payload = [ordered]@{ success = ($successCount -eq $results.Count); successCount = $successCount; failureCount = $results.Count - $successCount; outputDirectory = $outputRoot; report = $report; files = @($results) }
Write-Output ('WANWEI_RESULT=' + ($payload | ConvertTo-Json -Compress -Depth 6))
if ($successCount -ne $results.Count) { exit 2 }
