; Stop only processes whose executable is inside the chosen installation directory.
; Runtime directories can be reused by same-version installs. User data is untouched.
!define WANWEI_STOP_SCRIPT "${__FILEDIR__}\windows\stop-installation-processes.ps1"
!macro WANWEI_STOP_RUNNING_APP
  InitPluginsDir
  File /oname=$PLUGINSDIR\wanwei-stop-installation-processes.ps1 "${WANWEI_STOP_SCRIPT}"
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  System::Call 'kernel32::SetEnvironmentVariable(t "WANWEI_INSTALLER_PID", t r0)'
  System::Call 'kernel32::SetEnvironmentVariable(t "WANWEI_INSTALL_ROOT", t "$INSTDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "WANWEI_INSTALL_STOP_SCRIPT", t "$PLUGINSDIR\wanwei-stop-installation-processes.ps1")'
  StrCpy $2 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $2 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${Do}
    nsExec::ExecToStack /TIMEOUT=25000 '"$2" -NoProfile -NonInteractive -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($$env:WANWEI_INSTALL_STOP_SCRIPT))) -InstallDirectory $$env:WANWEI_INSTALL_ROOT"'
    Pop $0
    Pop $1
    DetailPrint "$1"
    ${If} $0 == 0
      ${ExitDo}
    ${EndIf}
    IfSilent 0 +2
      Abort "Unable to stop the installed application. Close it and retry."
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Unable to stop the installed application. Close it and retry.$\r$\n$1" IDRETRY +2
      Abort
  ${Loop}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WANWEI_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WANWEI_STOP_RUNNING_APP
!macroend
