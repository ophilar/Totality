; Custom NSIS uninstall script for Totality
; Ensures complete cleanup of installation directory and optionally app data

!macro customInit
  ; Check if DB exists on install
  IfFileExists "$APPDATA\totality\totality.db" 0 +3
    MessageBox MB_YESNO|MB_ICONQUESTION "An existing Totality database was found.$\n$\nDo you want to delete it and start with a fresh installation?" IDNO +2
    Delete "$APPDATA\totality\totality.db"
!macroend

!macro customUnInstall
  ; Remove installation directory completely (fixes leftover files issue)
  RMDir /r "$INSTDIR"
!macroend
