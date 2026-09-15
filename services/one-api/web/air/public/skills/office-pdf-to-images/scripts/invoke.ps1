param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ToolArguments
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  throw '未找到 Python。请先安装 Python 3.10 或更高版本，并确保 python 在 PATH 中。'
}

$runtimeCommand = 'pdf-to-images'
$runtime = Join-Path $PSScriptRoot 'office_tools.py'
& $python.Source $runtime $runtimeCommand @ToolArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
