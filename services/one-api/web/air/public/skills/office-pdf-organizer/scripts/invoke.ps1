param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ToolArguments
)

$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  throw '未找到 Python。请先安装 Python 3.10 或更高版本，并确保 python 在 PATH 中。'
}

$operation = $ToolArguments[0]
if ($operation -notin @('merge', 'split')) { throw '第一个参数必须是 merge 或 split。' }
$runtimeCommand = if ($operation -eq 'merge') { 'pdf-merge' } else { 'pdf-split' }
$ToolArguments = @($ToolArguments | Select-Object -Skip 1)
$runtime = Join-Path $PSScriptRoot 'office_tools.py'
& $python.Source $runtime $runtimeCommand @ToolArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
