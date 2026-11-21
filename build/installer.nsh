!macro customInstall
  CreateShortCut "$SMSTARTUP\The Land of Legends Cast Receiver.lnk" "$INSTDIR\The Land of Legends Cast Receiver.exe" "" "$INSTDIR\The Land of Legends Cast Receiver.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\The Land of Legends Cast Receiver.lnk"
!macroend
