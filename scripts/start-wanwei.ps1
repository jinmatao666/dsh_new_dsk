<#
.SYNOPSIS
Starts the local Wanwei desktop, OneAPI backend and management workbench.
.DESCRIPTION
Uses the existing backend executable, wanwei-desktop profile and local token cache.
Reuses listening services and prints the authenticated desktop URL after HTTP checks.
With -Refresh, builds the knowledge/auth client bundles and backend before restarting
this repository's backend and desktop. The workbench uses Vite source reload.
After refresh, reload the desktop browser page (Ctrl+F5) to load the new bundles.
.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\wbuddu\scripts\start-wanwei.ps1
.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\wbuddu\scripts\start-wanwei.ps1 -Refresh
#>
param(
    [switch]$Refresh,
    [string]$GoExe = 'D:\go-sdk\go\bin\go.exe'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repoRoot '.cache'
$backendRoot = Join-Path $repoRoot 'services/one-api'
$adminRoot = Join-Path $backendRoot 'web/air'
$backendExe = Join-Path $backendRoot 'bin/one-api-planning-lecture.exe'
$desktopHome = Join-Path $repoRoot '.wanwei-dev-home'

function Test-LocalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Start-LocalService($Name, $Port, $Executable, $Arguments, $Directory, $LogName) {
    if (Test-LocalPort $Port) {
        Write-Host "$Name is already listening on port $Port."
        return $null
    }
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments `
        -WorkingDirectory $Directory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDirectory "$LogName.out.log") `
        -RedirectStandardError (Join-Path $logDirectory "$LogName.err.log")
    Write-Host "Started $Name (PID $($process.Id), port $Port)."
    return $process
}

function Wait-LocalHttp($Name, $Url, $Process, $LogName) {
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    do {
        if ($null -ne $Process -and $Process.HasExited) {
            throw "$Name exited. Check $logDirectory/$LogName.out.log and $LogName.err.log."
        }
        try {
            return Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        }
        catch {
            if ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { throw }
            # Connection refusal and server startup errors are retried until the deadline.
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Name did not respond within 120 seconds. Check $logDirectory/$LogName.out.log and $LogName.err.log."
}

$requiredPaths = @(
    (Join-Path $backendRoot 'tiktoken-cache/9b5ad71b2ce5302211f9c61530b329a4922fc6a4'),
    (Join-Path $backendRoot 'tiktoken-cache/fb374d419588a4632f3f557e76b4b70aebbca790'),
    (Join-Path $adminRoot 'node_modules/vite/bin/vite.js'),
    (Join-Path $repoRoot 'node_modules/tsx/package.json'),
    (Join-Path $repoRoot 'apps/cli/src/bin.ts'),
    (Join-Path $repoRoot 'products/wanwei-desktop/scripts/stage-web-assets.mjs'),
    (Join-Path $desktopHome 'profiles/wanwei-desktop/package.json')
)
foreach ($path in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required local file is missing: $path" }
}
if (-not $Refresh -and -not (Test-Path -LiteralPath $backendExe)) {
    throw "Backend executable is missing. Run this script with -Refresh to build it."
}
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

if ($Refresh) {
    if (-not (Test-Path -LiteralPath $GoExe)) { throw "Go executable is missing: $GoExe" }
    $pnpmExe = (Get-Command pnpm.cmd -ErrorAction Stop).Source
    $replacementExe = Join-Path $backendRoot 'bin/one-api-refresh.exe'
    New-Item -ItemType Directory -Path (Split-Path -Parent $replacementExe) -Force | Out-Null
    Push-Location $repoRoot
    try {
        & $pnpmExe exec tsc -b packages/wanwei/oneapi-auth/tsconfig.host.json packages/wanwei/knowledge-base/tsconfig.json
        if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed; running services were kept.' }
        Push-Location (Join-Path $repoRoot 'packages/client/ui-primitives')
        try {
            & (Join-Path $repoRoot 'node_modules/.bin/tsdown.cmd')
            if ($LASTEXITCODE -ne 0) { throw 'UI primitives build failed; running services were kept.' }
        }
        finally { Pop-Location }
        & $pnpmExe run build:web
        if ($LASTEXITCODE -ne 0) { throw 'Web frontend build failed; running services were kept.' }
        & $pnpmExe --filter '@deepseek-ai/dsh-wanwei-knowledge-base' --filter '@deepseek-ai/dsh-wanwei-oneapi-auth' --filter '@deepseek-ai/dsh-client-ui-chat' run bundle
        if ($LASTEXITCODE -ne 0) { throw 'Desktop client bundle build failed; running services were kept.' }
    }
    finally { Pop-Location }
    # Keep Go's temporary linker output on the repository drive.
    $goTemp = Join-Path $logDirectory 'go-tmp'
    New-Item -ItemType Directory -Path $goTemp -Force | Out-Null
    $previousGoTemp = $env:GOTMPDIR
    Push-Location $backendRoot
    try {
        $env:GOTMPDIR = $goTemp
        & $GoExe build -o $replacementExe .
        if ($LASTEXITCODE -ne 0) { throw 'OneAPI build failed; running services were kept.' }
    }
    finally { $env:GOTMPDIR = $previousGoTemp; Pop-Location }

    # Only processes identified as this repository's services may be restarted.
    $ownedProcesses = @()
    foreach ($port in @(3002, 3080)) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        foreach ($listenerPid in @($listeners.OwningProcess | Select-Object -Unique)) {
            $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid"
            $expected = if ($port -eq 3002) {
                $serviceProcess.ExecutablePath -eq $backendExe
            } else {
                $serviceProcess.ExecutablePath -eq $nodeExe -and
                $serviceProcess.CommandLine -match 'apps[/\\]cli[/\\]src[/\\]bin\.ts' -and
                $serviceProcess.CommandLine -match '--profile\s+wanwei-desktop'
            }
            if (-not $expected) { throw "Port $port is owned by an unrelated process; refusing to stop PID $listenerPid." }
            $ownedProcesses += $serviceProcess
        }
    }
    foreach ($serviceProcess in $ownedProcesses) {
        Stop-Process -Id $serviceProcess.ProcessId -Force -ErrorAction Stop
        Wait-Process -Id $serviceProcess.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
    }
    Move-Item -LiteralPath $replacementExe -Destination $backendExe -Force
    Write-Host 'Refreshed backend and desktop client bundles. Reload the desktop page with Ctrl+F5.'
}

& $nodeExe (Join-Path $repoRoot 'products/wanwei-desktop/scripts/stage-web-assets.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Product Web asset staging failed.' }

$previousHome = $env:DSH_HOME
$previousApi = $env:DSH_ONEAPI_URL
$previousTokenCache = $env:TIKTOKEN_CACHE_DIR
try {
    $env:TIKTOKEN_CACHE_DIR = Join-Path $backendRoot 'tiktoken-cache'
    $backend = Start-LocalService 'OneAPI' 3002 $backendExe @('--port', '3002') $backendRoot 'oneapi-3002'
    $backendResponse = Wait-LocalHttp 'OneAPI' 'http://127.0.0.1:3002/api/status' $backend 'oneapi-3002'
    if (($backendResponse.Content | ConvertFrom-Json).success -ne $true) {
        throw 'Port 3002 did not return a successful OneAPI status.'
    }

    $admin = Start-LocalService 'Workbench' 3000 $nodeExe @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3000', '--strictPort') $adminRoot 'admin-3000'
    $null = Wait-LocalHttp 'Workbench' 'http://127.0.0.1:3000/' $admin 'admin-3000'

    $env:DSH_HOME = $desktopHome
    $env:DSH_ONEAPI_URL = 'http://127.0.0.1:3002'
    $desktop = Start-LocalService 'Wanwei desktop' 3080 $nodeExe @('--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '3080', '--no-open') $repoRoot 'desktop-3080'
    $desktopLog = Join-Path $logDirectory 'desktop-3080.out.log'
    $desktopUrl = ''
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    do {
        if ($null -ne $desktop -and $desktop.HasExited) {
            throw "Wanwei desktop exited. Check $logDirectory/desktop-3080.err.log."
        }
        if (Test-Path -LiteralPath $desktopLog) {
            $logText = Get-Content -LiteralPath $desktopLog -Raw
            if ($null -ne $logText) {
                $desktopUrl = [regex]::Match($logText, 'http://127\.0\.0\.1:3080/\?token=[^\s]+').Value
            }
        }
        if ($desktopUrl -ne '' -or $null -eq $desktop) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($desktopUrl -eq '') { throw "Desktop token URL is missing from $desktopLog." }
    $page = Wait-LocalHttp 'Wanwei desktop' $desktopUrl $desktop 'desktop-3080'
    if (-not $page.Content.Contains('wanwei-knowledge-base')) {
        throw 'Port 3080 did not load the Wanwei knowledge-base module. Check the existing service.'
    }
    Write-Host ''
    Write-Host "Desktop:   $desktopUrl"
    Write-Host 'Workbench: http://127.0.0.1:3000/'
    Write-Host 'Backend:   http://127.0.0.1:3002/'
    Write-Host "Logs:      $logDirectory"
}
finally {
    $env:DSH_HOME = $previousHome
    $env:DSH_ONEAPI_URL = $previousApi
    $env:TIKTOKEN_CACHE_DIR = $previousTokenCache
}
