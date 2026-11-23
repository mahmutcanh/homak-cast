!macro customInstall
  CreateShortCut "$SMSTARTUP\Cast Receiver.lnk" "$INSTDIR\Cast Receiver.exe" "" "$INSTDIR\Cast Receiver.exe" 0
  ; Let phones on the same LAN reach the embedded signaling/web-sender server.
  ; All profiles: a LAN often gets classified as "Public", which silently blocked phones.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast LAN"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast Receiver App"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Cast LAN" dir=in action=allow protocol=TCP localport=80,443,5240,5241 profile=any'
  ; Program rule (TCP+UDP, any port) so WebRTC media and LAN discovery also pass.
  nsExec::Exec 'netsh advfirewall firewall add rule name="Cast Receiver App" dir=in action=allow program="$INSTDIR\Cast Receiver.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\Cast Receiver.lnk"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast LAN"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Cast Receiver App"'
!macroend
