# Work Log - 2026-07-26

## Summary
Fixed wishlist item validation error caused by invalid/unparsed `year` values, and reviewed installation database preservation behavior.

## Details
- **Wishlist Add Validation Fix**:
  - Identified validation failure in `wishlist:add` IPC handler (`Validation failed: year: Invalid input`).
  - Added `z.preprocess()` to [schemas.ts](file:///H:/Totality/src/main/validation/schemas.ts) in `WishlistItemSchema` to sanitize empty string, null, undefined, or `NaN` `year` values to `undefined`.
  - Added client-side sanitization in [AddToWishlistButton.tsx](file:///H:/Totality/src/renderer/src/components/wishlist/AddToWishlistButton.tsx) (`typeof year === 'number' && !isNaN(year) ? year : undefined`).
  - Verified test suite passes without regressions.
- **Installer Database Retention Audit**:
  - Inspected NSIS setup config [electron-builder.yml](file:///H:/Totality/electron-builder.yml) and custom uninstaller script [installer.nsh](file:///H:/Totality/resources/installer.nsh).
  - Confirmed `deleteAppDataOnUninstall` is explicitly `false` for standard updates/installations.
  - Confirmed standard update/re-installation preserves `%APPDATA%\totality` (which stores the SQLite database `totality.db`). Data deletion is only prompted during manual uninstallation.
