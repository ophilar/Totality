; Custom NSIS uninstall script for Totality
; Offer a database reset during interactive upgrades while preserving playback targets.
; Offer full app-data removal only during an explicit interactive uninstall.

!macro customInstall
  ${ifNot} ${Silent}
    ${if} ${FileExists} "$APPDATA\totality\totality-v2.db"
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Do you want to reset your Totality database during this upgrade?$\n$\nThis removes your library, settings, sources, and scan history.$\nPlayback target profiles will be kept.$\nThis action cannot be undone." IDNO keepDatabase
      Delete "$APPDATA\totality\totality-v2.db"
      Delete "$APPDATA\totality\totality-v2.db-wal"
      Delete "$APPDATA\totality\totality-v2.db-shm"
      keepDatabase:
    ${endIf}
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Do you want to PERMANENTLY DELETE your Totality data?$\n$\nThis will remove your database, settings, and all scan history.$\nThis action cannot be undone.$\n$\nLocation: $APPDATA\totality" IDNO keepAppData
      RMDir /r "$APPDATA\totality"
      keepAppData:
    ${endIf}
  ${endIf}
!macroend
