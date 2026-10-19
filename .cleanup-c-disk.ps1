$ErrorActionPreference = 'SilentlyContinue'
$log = 'D:\wbuddu\.disk-cleanup.log'
function L([string]$m) {
  Add-Content -LiteralPath $log -Value $m -Encoding UTF8
}
Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
L "=== START $(Get-Date -Format o) ==="

function Get-DirSizeGB([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
  if ($null -eq $sum) { return 0 }
  return [math]::Round(($sum / 1GB), 2)
}

function Clear-DirContents([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    L "SKIP missing $path"
    return 0
  }
  $before = Get-DirSizeGB $path
  Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
  $after = Get-DirSizeGB $path
  $freed = [math]::Round(($before - $after), 2)
  L ("CLEARED {0}: before={1}GB after={2}GB freed~={3}GB" -f $path, $before, $after, $freed)
  return $freed
}

$c = Get-PSDrive C
L ("BEFORE FreeGB={0:N2} UsedGB={1:N2}" -f ($c.Free / 1GB), ($c.Used / 1GB))

# Safe caches / temps
$paths = @(
  $env:TEMP,
  "$env:LOCALAPPDATA\Temp",
  'C:\Windows\Temp',
  "$env:LOCALAPPDATA\npm-cache",
  "$env:LOCALAPPDATA\pnpm-cache",
  "$env:LOCALAPPDATA\Yarn\Cache",
  "$env:LOCALAPPDATA\pip\Cache",
  "$env:LOCALAPPDATA\NuGet\v3-cache",
  "$env:LOCALAPPDATA\Microsoft\Windows\INetCache",
  "$env:LOCALAPPDATA\CrashDumps",
  "$env:LOCALAPPDATA\D3DSCache",
  "$env:LOCALAPPDATA\Microsoft\Windows\DeliveryOptimization\Cache",
  "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache",
  "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Code Cache",
  "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache",
  "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Code Cache",
  "$env:LOCALAPPDATA\Cursor\Cache",
  "$env:LOCALAPPDATA\Cursor\CachedData",
  "$env:LOCALAPPDATA\Cursor\Code Cache",
  "$env:LOCALAPPDATA\Cursor\GPUCache",
  "$env:APPDATA\Cursor\Cache",
  "$env:LOCALAPPDATA\Temp\WinSAT"
)

foreach ($p in $paths) {
  [void](Clear-DirContents $p)
}

# Empty Recycle Bin
try {
  Clear-RecycleBin -Force -ErrorAction SilentlyContinue
  L 'CLEARED RecycleBin'
} catch {
  L ("RecycleBin skip: {0}" -f $_.Exception.Message)
}

# Windows Update download cache (safe; will re-download if needed)
$wu = "$env:WINDIR\SoftwareDistribution\Download"
[void](Clear-DirContents $wu)

# Thumbnail cache
Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Windows\Explorer" -Filter 'thumbcache_*.db' -Force -ErrorAction SilentlyContinue |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
  }
L 'CLEARED thumbcache_*.db'

# Large LocalAppData dirs (>1GB) report only
L '=== LocalAppData dirs > 1GB after cleanup ==='
Get-ChildItem "$env:LOCALAPPDATA" -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
  $s = Get-DirSizeGB $_.FullName
  if ($null -ne $s -and $s -ge 1) {
    L ("{0:N2} GB  {1}" -f $s, $_.FullName)
  }
}

$c2 = Get-PSDrive C
L ("AFTER FreeGB={0:N2} UsedGB={1:N2}" -f ($c2.Free / 1GB), ($c2.Used / 1GB))
L "=== DONE $(Get-Date -Format o) ==="
