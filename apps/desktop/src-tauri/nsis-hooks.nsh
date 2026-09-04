; Stop the installed product before NSIS replaces its bundled Node runtime.
; The product name determines the executable name, not the Rust crate name.
; /T also terminates its runtime Node children and releases sharp/libvips.dll.
; Keep the former executable name for upgrades from early packages. A prior
; abnormal exit can leave the bundled Node process orphaned, so the final
; command targets only node.exe launched from this installation's runtime.
!macro ZJUGIS_STOP_RUNNING_APP
  nsExec::ExecToLog 'taskkill.exe /F /T /IM "ZJUGIS Harness.exe"'
  nsExec::ExecToLog 'taskkill.exe /F /T /IM dsh-desktop.exe'
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq ''$INSTDIR\resources\runtime\node.exe'' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
  Sleep 3000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend
