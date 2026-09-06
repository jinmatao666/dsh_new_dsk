; Stop the installed product before NSIS replaces its bundled Node runtime.
; The product name determines the executable name, not the Rust crate name.
; Keep the former executable name for upgrades from early packages. A prior
; abnormal exit can leave the bundled Node process orphaned, so only node.exe
; started from this installation's runtime is terminated. The PowerShell loop
; also waits until sharp's native DLL has no remaining file handle; upgrades
; therefore normally proceed with no visible retry prompt.
!macro ZJUGIS_STOP_RUNNING_APP
  nsExec::ExecToLog 'taskkill.exe /F /T /IM "ZJUGIS Harness.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill.exe /F /T /IM dsh-desktop.exe'
  Pop $0
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$node = [IO.Path]::GetFullPath(''$INSTDIR\resources\runtime\node.exe''); $$dll = ''$INSTDIR\resources\runtime\app\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll''; $$deadline = [DateTime]::UtcNow.AddSeconds(30); do { Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq $$node } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; $$locked = $$false; if (Test-Path -LiteralPath $$dll) { try { $$stream = [IO.File]::Open($$dll, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); $$stream.Dispose() } catch { $$locked = $$true } }; if (-not $$locked) { exit 0 }; Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $$deadline); exit 1"'
  Pop $0
  StrCmp $0 "0" +2
  MessageBox MB_ICONSTOP "ZJUGIS Harness 的运行文件仍被占用。请关闭该程序后重新安装。"
  Abort
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend
