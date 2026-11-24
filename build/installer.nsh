!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Network choices made on the setup page, saved to %ProgramData%\HomakCast\install.ini
; (the receiver reads that file at startup). Silent installs keep an existing file or use 80 / 443.
!ifndef BUILD_UNINSTALLER
Var CastDlg
Var CastHttpField
Var CastHttpsField
Var CastDomainField
Var CastHttpPort
Var CastHttpsPort
Var CastDomain
Var CastOldHttp
Var CastOldHttps
!endif

!macro CastLoadIni
  ReadEnvStr $0 PROGRAMDATA
  ReadINIStr $CastHttpPort "$0\HomakCast\install.ini" "net" "HttpPort"
  ReadINIStr $CastHttpsPort "$0\HomakCast\install.ini" "net" "HttpsPort"
  ReadINIStr $CastDomain "$0\HomakCast\install.ini" "net" "Domain"
  StrCpy $CastOldHttp $CastHttpPort
  StrCpy $CastOldHttps $CastHttpsPort
  ${If} $CastHttpPort == ""
    StrCpy $CastHttpPort "80"
  ${EndIf}
  ${If} $CastHttpsPort == ""
    StrCpy $CastHttpsPort "443"
  ${EndIf}
!macroend

; $0 = port text. Result in $1: 1 = valid TCP port, 0 = not.
!macro CastCheckPort
  StrCpy $1 0
  IntOp $2 $0 + 0
  ${If} $2 > 0
  ${AndIf} $2 < 65536
  ${AndIf} "$2" == "$0"
    StrCpy $1 1
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  ; Defined here (not at the top) because MUI macros only exist after electron-builder includes MUI2.
Function CastNetPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  !insertmacro CastLoadIni

  nsDialogs::Create 1018
  Pop $CastDlg
  ${If} $CastDlg == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Ağ ayarları" "Telefonların bağlanacağı portları ve isteğe bağlı alan adını seçin."

  ${NSD_CreateLabel} 0 0 100% 24u "Telefonlar bu bilgisayara bu portlardan bağlanır. Varsayılan 80 ve 443 olduğunda adres sonuna port yazmak gerekmez."
  Pop $0

  ${NSD_CreateLabel} 0 34u 45% 12u "HTTP portu:"
  Pop $0
  ${NSD_CreateText} 50% 32u 30% 12u "$CastHttpPort"
  Pop $CastHttpField

  ${NSD_CreateLabel} 0 52u 45% 12u "HTTPS portu:"
  Pop $0
  ${NSD_CreateText} 50% 50u 30% 12u "$CastHttpsPort"
  Pop $CastHttpsField

  ${NSD_CreateLabel} 0 76u 100% 12u "Alan adı (isteğe bağlı), örn. cast.sirket.local:"
  Pop $0
  ${NSD_CreateText} 0 90u 80% 12u "$CastDomain"
  Pop $CastDomainField

  ${NSD_CreateLabel} 0 110u 100% 24u "Alan adı bu bilgisayarın IP adresine yönlenmiş olmalıdır (DNS veya hosts). Boş bırakılırsa IP adresi kullanılır."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function CastNetPageLeave
  ${NSD_GetText} $CastHttpField $CastHttpPort
  ${NSD_GetText} $CastHttpsField $CastHttpsPort
  ${NSD_GetText} $CastDomainField $CastDomain

  StrCpy $0 $CastHttpPort
  !insertmacro CastCheckPort
  ${If} $1 == 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "HTTP portu 1 ile 65535 arasında bir sayı olmalıdır."
    Abort
  ${EndIf}
  StrCpy $0 $CastHttpsPort
  !insertmacro CastCheckPort
  ${If} $1 == 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "HTTPS portu 1 ile 65535 arasında bir sayı olmalıdır."
    Abort
  ${EndIf}
  ${If} $CastHttpPort == $CastHttpsPort
    MessageBox MB_ICONEXCLAMATION|MB_OK "HTTP ve HTTPS portları farklı olmalıdır."
    Abort
  ${EndIf}

  ; Warn when another program already listens on a chosen port (our own earlier choice is fine).
  ${If} $CastHttpPort != $CastOldHttp
    nsExec::ExecToStack 'cmd /c netstat -ano -p tcp | findstr /R /C:":$CastHttpPort .*LISTENING"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      MessageBox MB_ICONQUESTION|MB_YESNO "$CastHttpPort portu başka bir program tarafından kullanılıyor. Yine de bu portu kullanmak istiyor musunuz?$\r$\n(Hayır derseniz başka port girebilirsiniz. Kullanımda kalırsa uygulama 5240 ve 5241 portlarına geçer.)" IDYES +2
      Abort
    ${EndIf}
  ${EndIf}
  ${If} $CastHttpsPort != $CastOldHttps
    nsExec::ExecToStack 'cmd /c netstat -ano -p tcp | findstr /R /C:":$CastHttpsPort .*LISTENING"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      MessageBox MB_ICONQUESTION|MB_YESNO "$CastHttpsPort portu başka bir program tarafından kullanılıyor. Yine de bu portu kullanmak istiyor musunuz?$\r$\n(Hayır derseniz başka port girebilirsiniz. Kullanımda kalırsa uygulama 5240 ve 5241 portlarına geçer.)" IDYES +2
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

  Page custom CastNetPageCreate CastNetPageLeave
!macroend

!macro customInstall
  CreateShortCut "$SMSTARTUP\Cast Receiver.lnk" "$INSTDIR\Cast Receiver.exe" "" "$INSTDIR\Cast Receiver.exe" 0

  ; Silent installs never show the page: keep what is saved, else defaults.
  ${If} ${Silent}
    !insertmacro CastLoadIni
  ${EndIf}
  ReadEnvStr $0 PROGRAMDATA
  CreateDirectory "$0\HomakCast"
  WriteINIStr "$0\HomakCast\install.ini" "net" "HttpPort" "$CastHttpPort"
  WriteINIStr "$0\HomakCast\install.ini" "net" "HttpsPort" "$CastHttpsPort"
  WriteINIStr "$0\HomakCast\install.ini" "net" "Domain" "$CastDomain"

  ; Let phones on the same LAN reach the embedded signaling/web-sender server.
  ; All profiles: a LAN often gets classified as "Public", which silently blocked phones.
  ; 5240/5241 stay open as the automatic fallback when the chosen ports are busy.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast LAN"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast Receiver App"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Cast LAN" dir=in action=allow protocol=TCP localport=$CastHttpPort,$CastHttpsPort,5240,5241 profile=any'
  ; Program rule (TCP+UDP, any port) so WebRTC media and LAN discovery also pass.
  nsExec::Exec 'netsh advfirewall firewall add rule name="Cast Receiver App" dir=in action=allow program="$INSTDIR\Cast Receiver.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\Cast Receiver.lnk"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast LAN"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast Receiver App"'
  ReadEnvStr $0 PROGRAMDATA
  Delete "$0\HomakCast\install.ini"
!macroend
