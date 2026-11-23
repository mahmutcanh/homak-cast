!macro customInstall
  CreateShortCut "$SMSTARTUP\Cast Receiver.lnk" "$INSTDIR\Cast Receiver.exe" "" "$INSTDIR\Cast Receiver.exe" 0
  ; Let phones on the same LAN reach the embedded signaling/web-sender server.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast LAN"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Cast LAN" dir=in action=allow protocol=TCP localport=5240,5241 profile=private,domain'
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\Cast Receiver.lnk"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast LAN"'
!macroend
