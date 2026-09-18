; Each release writes its runtime into a versioned resource directory, so an
; orphaned Node sidecar cannot block replacement of Sharp's native DLL. Close
; only the preview shell; the existing production Wanwei Buddy stays untouched.
!macro WANWEI_PREVIEW_STOP_RUNNING_APP
  nsExec::Exec 'taskkill.exe /F /T /IM "wanwei-buddy-preview.exe"'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WANWEI_PREVIEW_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WANWEI_PREVIEW_STOP_RUNNING_APP
!macroend
