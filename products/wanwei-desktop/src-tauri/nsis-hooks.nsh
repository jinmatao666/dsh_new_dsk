; Close only the preview application before replacing its executable and
; versioned runtime. The existing production Wanwei Buddy remains untouched
; while the new-version branch is under evaluation.
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
