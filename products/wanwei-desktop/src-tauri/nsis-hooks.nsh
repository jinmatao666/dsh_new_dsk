; Each release writes its runtime into a versioned resource directory, so an
; orphaned Node sidecar cannot block replacement of Sharp's native DLL. Close
; upgraded desktop shells. User data directories are never removed here.
!macro WANWEI_STOP_RUNNING_APP
  nsExec::Exec 'taskkill.exe /F /T /IM "wanwei-buddy.exe"'
  Pop $0
  nsExec::Exec 'taskkill.exe /F /T /IM "dsh-desktop.exe"'
  Pop $0
  nsExec::Exec 'taskkill.exe /F /T /IM "wanwei-buddy-preview.exe"'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WANWEI_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WANWEI_STOP_RUNNING_APP
!macroend
