; Custom NSIS uninstall script for Totality
; Offer app-data removal only during an explicit interactive uninstall.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Do you want to PERMANENTLY DELETE your Totality data?$\n$\nThis will remove your database, settings, and all scan history.$\nThis action cannot be undone.$\n$\nLocation: $APPDATA\totality" IDNO keepAppData
      RMDir /r "$APPDATA\totality"
      keepAppData:
    ${endIf}
  ${endIf}
!macroend
