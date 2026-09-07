; A release writes its runtime into a versioned resource directory, so it never
; overwrites a Sharp DLL loaded by an earlier release. Close the visible shell
; when possible to make the executable upgrade prompt-free as well.
!macro ZJUGIS_STOP_RUNNING_APP
  nsExec::Exec 'taskkill.exe /F /T /IM "ZJUGIS Harness.exe"'
  Pop $0
  nsExec::Exec 'taskkill.exe /F /T /IM dsh-desktop.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend
