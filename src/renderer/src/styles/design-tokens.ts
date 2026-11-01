/**
 * Design Tokens — Single Source of Truth
 *
 * All design constants live here. Reference docs/SKILL.md for the full system.
 * Import these instead of using magic numbers in components.
 */

// =============================================================================
// TYPOGRAPHY SCALE (SKILL.md §2)
// =============================================================================
// Format: size/lineHeight letterSpacing
// Font: Plus Jakarta Sans 400/500/600 only (no bold)

export const TYPE = {
  display: 'text-5xl leading-[52px] tracking-[-0.020em]',    // 48/52
  h1: 'text-[32px] leading-[38px] tracking-[-0.014em]',      // 32/38
  h2: 'text-2xl leading-[30px] tracking-[-0.012em]',         // 24/30
  h3: 'text-xl leading-[26px] tracking-[-0.009em]',          // 20/26
  title: 'text-[17px] leading-6 tracking-[-0.006em]',        // 17/24
  'body-lg': 'text-[17px] leading-[26px] tracking-[-0.006em]', // 17/26
  body: 'text-[15px] leading-[22px] tracking-[-0.004em]',    // 15/22
  label: 'text-sm leading-5 tracking-[-0.002em]',            // 14/20
  caption: 'text-[13px] leading-[18px] tracking-[0em]',      // 13/18
  micro: 'text-[11px] leading-[14px] tracking-[0.020em]',    // 11/14
} as const

// Font weights — only these three exist in the system
export const WEIGHT = {
  regular: 'font-normal',   // 400
  medium: 'font-medium',    // 500
  semibold: 'font-semibold', // 600
  // No bold (700) — use semibold instead
} as const

// =============================================================================
// SPACING SCALE (SKILL.md §4)
// =============================================================================
// 4px base, 8px grid for layout

export const SPACE = {
  /** Within a tight group (e.g., icon + label) */
  xs: 4,     // gap-1, p-1
  /** Within a group (related items) */
  sm: 8,     // gap-2, p-2
  /** Between related groups */
  md: 16,    // gap-4, p-4
  /** Between sections */
  lg: 32,    // gap-8, p-8
  /** Between major regions */
  xl: 64,    // gap-16, p-16
} as const

// Tailwind class equivalents for common spacing patterns
export const GAP = {
  withinGroup: 'gap-2',        // 8px
  betweenGroups: 'gap-4',      // 16px
  betweenSections: 'gap-8',    // 32px
  betweenRegions: 'gap-16',    // 64px
} as const

// Page padding by surface
export const PAGE_PADDING = {
  mobile: 'p-4',     // 16px
  tablet: 'px-6',    // 24px
  desktop: 'px-8',   // 32px
} as const

// =============================================================================
// RADIUS SCALE (SKILL.md §2)
// =============================================================================
// Three steps, each double the last

export const RADIUS = {
  /** Chips, badges, checkboxes, small indicators */
  sm: 'rounded',           // 4px
  /** All controls: buttons, inputs, selects, menu items */
  control: 'rounded-lg',   // 8px
  /** Cards, popovers, modals, sheets */
  card: 'rounded-2xl',     // 16px
  /** Pills, avatars */
  full: 'rounded-full',    // 9999px
} as const

// =============================================================================
// Z-INDEX SCALE
// =============================================================================
// Centralized to prevent stacking conflicts

export const Z = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  sidebar: 40,
  scrim: 45,
  panel: 46,
  modal: 50,
  topbar: 100,
  toast: 110,
} as const

// =============================================================================
// ANIMATION (SKILL.md §2)
// =============================================================================

export const DURATION = {
  fast: '120ms',    // hover/press
  base: '180ms',    // most transitions
  slow: '260ms',    // modals arriving
  slower: '400ms',  // route changes
} as const

export const EASING = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  entrance: 'cubic-bezier(0.16, 1, 0.3, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const

// Only these properties may animate (SKILL.md §2):
// opacity, transform, background-color, border-color, color, box-shadow, filter
// NEVER: width, height, top, left, margin, padding

// =============================================================================
// BUTTON SIZES (SKILL.md §3)
// =============================================================================

export const BUTTON_SIZE = {
  sm: 'h-8',   // 32px
  md: 'h-10',  // 40px (default)
  lg: 'h-12',  // 48px
} as const

// Touch target minimum: 44x44
// Directional (TV) target minimum: 56px

// =============================================================================
// CONTAINERS (SKILL.md §4)
// =============================================================================

export const CONTAINER = {
  reading: 'max-w-[720px]',    // reading/forms
  app: 'max-w-[1200px]',       // app shell
  dashboard: 'max-w-[1400px]', // dashboards & tables
} as const

// =============================================================================
// SHADOWS (SKILL.md §2)
// =============================================================================
// Light mode: depth via shadow. Dark mode: depth via surface lightness + hairline.

export const SHADOW = {
  raised: 'shadow-sm',   // cards, grouping boxes (light only)
  overlay: 'shadow-lg',  // menus, modals, popovers
  elevated: 'shadow-xl', // floating panels
} as const
