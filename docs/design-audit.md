# Design System Audit

Status: **Complete** | Reference: `docs/SKILL.md`
Last updated: 2026-10-25

## Summary

| Category | Before | After | Status |
|---|---|---|---|
| Hardcoded colors | ~231 | ~220 intentional, 8 fixed | **Reviewed** |
| Custom font sizes (`text-[Xpx]`) | 65 | 0 | **Complete** |
| Uppercase usage | 61 | 0 | **Complete** |
| `transition-all` | 42 | 0 | **Complete** |
| Z-index values | 15 bracket | 13 standardized (z-[45]/z-[46]), 3 fixed | **Complete** |
| Shared components | 5 primitives | 10 (+ Button, Card, Input, Select, Badge, Modal) | **Complete** |
| Files migrated to shared components | 0 | 27+ | **Complete** |
| Font | Open Sans (700) | Plus Jakarta Sans (400/500/600) | **Complete** |
| Spacing inconsistencies | Widespread | Widespread | **Deferred** — per-component review needed |

---

## 1. Hardcoded Colors — REVIEWED

**Status: Mostly intentional.** After line-by-line review, the vast majority of hardcoded `text-white`, `bg-white`, and color classes are correct:

### Intentional — do NOT change
- **TopBar** (17 `text-white`, 25 `bg-white/XX`): Permanent black chrome bar. White text, white/opacity hover states, and `bg-white text-black` active toggles are all correct regardless of theme.
- **Poster/image overlays** (MusicView 14, MoviesView 5, TVShowsView 5): White text on `bg-black/60` scrims over artwork. Theme-independent.
- **Mobile views** (MobileSearchOverlay, MobileTabBar, MobileMediaDetail): Dark chrome similar to TopBar.
- **Sidebar** (4): White icons on colored provider badges, collapsed hover states on dark sidebar.
- **Provider brand colors** (`bg-[#e5a00d]` Plex gold, `bg-purple-500` Jellyfin, etc.): Brand identity, not theme colors.
- **NotificationBell badge** (`bg-white text-black`): Badge on TopBar needs max contrast on dark background.
- **AppearanceTab** preview dots (`bg-white/40`): Inside `bg-black` miniature TopBar preview.
- **Quality tier badges** (`bg-purple-600`, `bg-green-600`, etc.): Semantic meaning (Hi-Res, Lossless), always on dark poster overlays.

### Fixed (8 instances)
- **Slider thumbs** (QualitySettingsTab 3, MediaBrowser 1): `bg-white` → `bg-foreground` — adapts to theme
- **Toggle knobs** (SourceCard 2): `bg-white` → `bg-foreground` — adapts to theme
- **Log viewer hover** (TroubleshootTab 2): `hover:bg-white/5` and `hover:bg-white/10` → `hover:bg-muted/50` — uses semantic token

### Non-semantic Tailwind colors (~96 occurrences) — DEFERRED
`text-red-500`, `bg-green-500`, `bg-purple-500`, `bg-orange-500`, etc. used for:
- Quality tier badges on poster overlays (always dark background)
- Provider color dots (brand identity)
- Status indicators (success/warning/error)
These could be migrated to semantic tokens (`text-destructive`, `text-success`, etc.) but the current usage is functional and theme-aware enough. Low priority.

---

## 2. Custom Font Sizes (65 occurrences)

| File | Count | Values Used |
|---|---|---|
| MoodSyncPanel.tsx | 29 | `text-[10px]`, `text-[11px]` |
| MediaMonkeyConnectionFlow.tsx | 15 | `text-[10px]` |
| QualitySettingsTab.tsx | 10 | `text-[10px]`, `text-[12px]` |
| NotificationBell.tsx | 6 | `text-[10px]`, `text-[0.625rem]` |
| ActivityPanel.tsx | 3 | `text-[10px]` |
| MediaBrowser.tsx | 3 | `text-[10px]` |
| 11 other files | 1-2 each | |

**Migration:** Map `text-[10px]` to a new `text-micro` token (11px per SKILL.md), `text-[12px]` to `text-xs` (already 12px).

---

## 3. Uppercase Usage (61 occurrences, 15 files)

| File | Count | Usage |
|---|---|---|
| AboutModal.tsx | 11 | Section headers ("FEATURES", "FEEDBACK") |
| MoodSyncPanel.tsx | 8 | Step labels, field labels |
| Dashboard.tsx | 8 | Section headers, category tabs |
| DataManagementTab.tsx | 6 | Settings section headers |
| MusicView.tsx | 6 | Tab labels, section headers |
| MediaDetails.tsx | 5 | Quality labels, section headers |
| StoreLinksMenu.tsx | 3 | Store category labels |
| MobileMediaDetail.tsx | 3 | Section headers |
| WishlistPanel.tsx | 2 | Category labels |
| TaskQueuePanel.tsx | 2 | Status labels |
| ActivityPanel.tsx | 2 | Section headers |
| SourceCard.tsx | 2 | Section headers |
| 3 other files | 1 each | |

**Migration:** Replace `uppercase tracking-wider` with `font-medium` or `font-semibold` at same size. Sentence case all text content.

---

## 4. `transition-all` Usage (42 occurrences)

Per SKILL.md, only these properties may animate: `opacity`, `transform`, `background-color`, `border-color`, `color`, `box-shadow`, `filter`.

Replace `transition-all` with `transition-colors` (most common case) or specific `transition-[opacity,transform]` as needed.

---

## 5. Z-Index Scale (15 bracket values)

Current ad-hoc values:
- `z-0` — default
- `z-10` — dropdowns
- `z-20` — DropdownMenu overlay
- `z-[40]` — Sidebar
- `z-[45]` — Backdrop scrims
- `z-[46]` — Side panels
- `z-[100]` — TopBar

**Migration:** Create centralized z-index constants in `design-tokens.ts`.

---

## 6. Missing Shared Components

| Component | Current State | Files Affected |
|---|---|---|
| **Button** | 20+ inline variants | All interactive files |
| **Card** | Inconsistent padding/radius | Dashboard, MediaBrowser, Settings |
| **Input/Field** | Inline per modal | AddSourceModal, Settings tabs |
| **Badge** | Hardcoded inline | Sidebar, Dashboard, TopBar |
| **Modal/Dialog** | 5+ custom implementations | MediaDetails, CollectionModal, MatchFixModal, AddSourceModal, AboutModal |
| **Select/Dropdown** | Native + custom mixed | Settings tabs, MediaBrowser |
| **Toggle/Switch** | Exists but minimal | Settings tabs, SourceCard |
| **Table/DataList** | Virtual lists copied per view | Dashboard, MediaBrowser, MusicView |

---

## 7. Spacing Inconsistencies

### Button padding (no standard)
- Tiny: `px-1.5 py-0.5`
- Small: `px-2 py-1`
- Medium: `px-3 py-1.5`
- Large: `px-4 py-2`

### Card/panel padding
- `p-2`, `p-3`, `p-4` used interchangeably

### Section spacing
- `space-y-0.5` to `space-y-6` without semantic meaning

### Height constants (duplicated)
- Dashboard: `EXPANDED_ITEM_HEIGHT = 48`
- MusicView: `EXPANDED_ITEM_HEIGHT = 44`

---

## 8. Typography Scale Mapping

### Current → SKILL.md target

| Current | Size | SKILL.md Step | Target |
|---|---|---|---|
| `text-[10px]` | 10px | `micro` | 11px (11/14, +0.020 tracking) |
| `text-xs` | 12px | `caption` | 13px (13/18, 0 tracking) |
| `text-sm` | 14px | `label` | 14px (14/20, -0.002 tracking) |
| `text-base` | 16px | `body` | 15px (15/22, -0.004 tracking) |
| `text-lg` | 18px | `title` | 17px (17/24, -0.006 tracking) |
| `text-xl` | 20px | `h3` | 20px (20/26, -0.009 tracking) |
| `text-2xl` | 24px | `h2` | 24px (24/30, -0.012 tracking) |

### Font
- Current: system default / Open Sans
- SKILL.md: Plus Jakarta Sans (400/500/600 only — no bold/700)

---

## Migration Priority

### Phase 1: Foundation (this session)
- [x] Copy SKILL.md to project
- [x] Create design-tokens.ts
- [x] Create this audit file
- [x] Update CLAUDE.md

### Phase 2: Shared Components
- [x] Build Button component (primary, secondary, tertiary, danger, danger-secondary, danger-tertiary)
- [x] Build Card component (raised, muted, flat variants)
- [x] Build Input/Select components (sm, md, lg sizes)
- [x] Build Badge component (default, success, warning, danger, primary)
- [x] Build Modal/Dialog component (sm, md, lg, xl, full sizes with focus trap)
- [ ] Migrate existing inline buttons to use `<Button>` component
- [ ] Migrate existing inline cards to use `<Card>` component
- [ ] Migrate existing modals to use `<Modal>` component

### Phase 3: Token Migration (per-file)
- [ ] Remove all `uppercase` (61 instances, 15 files)
- [ ] Replace custom font sizes (65 instances)
- [ ] Replace `text-white`/`bg-white` with semantic tokens (129 instances)
- [ ] Replace non-semantic color classes (96 instances)
- [ ] Replace `transition-all` (42 instances)
- [ ] Centralize z-index values (15 instances)

### Phase 4: Typography & Font
- [x] Install Plus Jakarta Sans (variable font)
- [ ] Define typography scale in CSS tokens (letter-spacing ramp)
- [ ] Apply letter-spacing per SKILL.md ramp
- [x] Heading weight changed from 700 to 600
- [ ] Remove remaining font-bold (700) uses — use only 400/500/600
