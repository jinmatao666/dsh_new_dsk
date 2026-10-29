# Installer-only cleanup. Match executable locations, never global process names.
param([Parameter(Mandatory = $true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
try {
    if (![IO.Path]::IsPathRooted($InstallDirectory)) { throw 'Installation directory must be absolute.' }
    $root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\', '/')
    $blocked = @(([IO.Path]::GetPathRoot($root).TrimEnd('\', '/')), $env:WINDIR, $env:USERPROFILE, $env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})
    if ($blocked | Where-Object { $_ -and $root.Equals($_.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase) }) {
        throw 'Refusing to stop processes for a system directory or drive root.'
    }
    $prefix = $root + [IO.Path]::DirectorySeparatorChar
    $installerPid = $env:WANWEI_INSTALLER_PID
    function Get-InstalledProcesses {
        Get-Process | Where-Object {
            $path = $_.Path
            if ($path -and $path.StartsWith('\\?\')) { $path = $path.Substring(4) }
            $_.Id -ne $PID -and [string]$_.Id -ne $installerPid -and $path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
        }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $remaining = @(Get-InstalledProcesses)
        if (!$remaining.Count) { Write-Output 'Installed application processes have stopped.'; exit 0 }
        foreach ($process in $remaining) {
            try {
                # Re-read the location before stopping to avoid a recycled process ID.
                $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
                if ($current -and $current.StartTime -eq $process.StartTime) {
                    Stop-Process -InputObject $current -Force -ErrorAction Stop
                    Write-Output ('Stopped installed process: ' + $process.ProcessName + ' (' + $process.Id + ')')
                }
            } catch {
                if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) { throw }
            }
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    if (@(Get-InstalledProcesses).Count) { throw 'Application processes did not exit within 15 seconds.' }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
