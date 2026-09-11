; A release writes its runtime into a versioned resource directory, so it never
; overwrites a Sharp DLL loaded by an earlier release. Close the visible shell
; when possible to make the executable upgrade prompt-free as well.
!macro WANWEI_STOP_RUNNING_APP
  ; Keep this legacy name so upgrades can close releases built before rebranding.
  nsExec::Exec 'taskkill.exe /F /T /IM "ZJUGIS Harness.exe"'
  Pop $0
  nsExec::Exec 'taskkill.exe /F /T /IM "万维Buddy.exe"'
  Pop $0
  nsExec::Exec 'taskkill.exe /F /T /IM dsh-desktop.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WANWEI_STOP_RUNNING_APP
!macroend

; Releases before the rebrand registered their own product name, installation
; directory, and shortcut. Tauri only detects an installed release by the
; current product name, so remove that legacy installation after the new one
; is safely in place. The legacy uninstaller keeps app data unless its own UI
; explicitly selected data deletion; silent migration never makes that choice.
!macro WANWEI_REMOVE_LEGACY_INSTALLATION
  ; The unnamed value is the raw installation directory. InstallLocation is
  ; quoted by Tauri's generated installer and cannot safely be extended.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZJUGIS Harness" ""
  StrCmp $0 "" wanwei_legacy_location_missing wanwei_legacy_location_found

  wanwei_legacy_location_missing:
  StrCpy $0 "$LOCALAPPDATA\ZJUGIS Harness"

  wanwei_legacy_location_found:
  ; Do not act if a user deliberately selected the legacy directory for this
  ; installation.
  StrCmp "$INSTDIR" "$0" wanwei_legacy_installation_done
  IfFileExists "$0\uninstall.exe" 0 wanwei_legacy_installation_done

  StrCpy $1 '"$0\uninstall.exe" /S _?=$0'
  ExecWait '$1' $2

  wanwei_legacy_installation_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro WANWEI_REMOVE_LEGACY_INSTALLATION
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WANWEI_STOP_RUNNING_APP
!macroend
