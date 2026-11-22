!macro customInstall
  CreateShortCut "$SMSTARTUP\The Land of Legends Cast Receiver.lnk" "$INSTDIR\The Land of Legends Cast Receiver.exe" "" "$INSTDIR\The Land of Legends Cast Receiver.exe" 0
  ; Let phones on the same LAN reach the embedded signaling/web-sender server.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Homak Cast LAN"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Homak Cast LAN" dir=in action=allow protocol=TCP localport=5240,5241 profile=private,domain'
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\The Land of Legends Cast Receiver.lnk"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Homak Cast LAN"'
!macroend
