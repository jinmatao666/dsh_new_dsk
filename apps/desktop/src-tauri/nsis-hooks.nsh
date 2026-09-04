; Stop the desktop shell before NSIS replaces its bundled Node runtime. The
; sidecar is a child of dsh-desktop, so /T also releases sharp/libvips.dll.
; Node can take longer than the original short delay to unload native modules.
; This applies to both an in-place upgrade and an uninstall/reinstall cycle.
!macro ZJUGIS_STOP_RUNNING_APP
  nsExec::ExecToLog 'taskkill.exe /F /T /IM dsh-desktop.exe'
  Sleep 3000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ZJUGIS_STOP_RUNNING_APP
!macroend
