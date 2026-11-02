; Custom NSIS installer macro script for Totality
; Provides standard installation lifecycle hooks for database retention prompt during setup and uninstall cleanup.

!macro customInstall
  ; Skip asking if running in silent installation mode
  IfSilent skipFreshPrompt

  ; Check if an existing database directory already exists from a prior installation
  IfFileExists "$APPDATA\totality\*.*" 0 skipFreshPrompt
    MessageBox MB_YESNO|MB_ICONQUESTION "An existing Totality database and application configuration was detected.$\n$\nWould you like to perform a FRESH install (erase existing database and settings)?$\n$\nSelect 'Yes' to start fresh with a clean database.$\nSelect 'No' to keep your existing media library database and settings." IDYES cleanAppData IDNO skipFreshPrompt

  cleanAppData:
    RMDir /r "$APPDATA\totality"

  skipFreshPrompt:
!macroend

!macro customUnInstall
  ; Ask user if they want to delete app data BEFORE removing install dir
  ; Skip asking if it's a silent uninstall (e.g., during an update)
  IfSilent skipDelete

  ; Only ask if the data directory actually exists
  IfFileExists "$APPDATA\totality\*.*" 0 skipDelete
    MessageBox MB_YESNO|MB_ICONQUESTION "Do you also want to delete your Totality data (database, settings)?$\n$\nLocation: $APPDATA\totality" IDYES deleteAppData IDNO skipDelete

  deleteAppData:
    RMDir /r "$APPDATA\totality"

  skipDelete:
    ; Remove installation directory completely (fixes leftover files issue)
    RMDir /r "$INSTDIR"
!macroend
