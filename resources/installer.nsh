; Custom NSIS uninstall script for Totality
; Ensures complete cleanup of installation directory and optionally app data

!macro customInit
  ; Check if DB exists on install
  IfFileExists "$APPDATA\totality\totality.db" 0 +3
    MessageBox MB_YESNO|MB_ICONQUESTION "An existing Totality database was found.$\n$\nDo you want to delete it and start with a fresh installation?" IDNO +2
    Delete "$APPDATA\totality\totality.db"
!macroend

!macro customUnInstall
  ; Ask user if they want to delete app data BEFORE removing install dir
  ; Only ask if the data directory actually exists
  IfFileExists "$APPDATA\totality\*.*" 0 skipDelete
    MessageBox MB_YESNO|MB_ICONQUESTION "Do you also want to delete your Totality data (database, settings)?$\n$\nLocation: $APPDATA\totality" IDYES deleteAppData IDNO skipDelete

  deleteAppData:
    RMDir /r "$APPDATA\totality"

  skipDelete:
    ; Remove installation directory completely (fixes leftover files issue)
    RMDir /r "$INSTDIR"
!macroend
