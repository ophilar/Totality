---
name: minimal
description: Minimal design system — the house style for every product, UI, Figma mock, and product spec, on every surface. Use whenever designing or building any user interface, component, screen, or flow — web, desktop app, phone, tablet, foldable, touch laptop, watch, TV, widget, or OS surface; when making something responsive or adapting a layout across screen sizes; when deciding what to show versus hide (progressive disclosure, overflow menus, grouping, information density); when writing a product spec, PRD, or design prompt; when creating or editing Figma designs; or when reviewing existing UI for craft. Covers monochrome light/dark tokens, button and control states, motion, layout, cross-surface adaptation, and the design principles all projects must satisfy.
---

# Minimal

The single house style. Every project — code, Figma, spec — inherits from this file.

The name is the brief: if an element can't justify itself, it isn't in the
design. Rename it if you want a different word on the tin; nothing else changes.

**The system in one line:** brightest white or very dark gray, black-and-white
actions, one line weight, one radius language, color only when it means
something, motion only where a human is touching the thing.

---

## 0. The rule above all rules

**Good design solves the job to be done.** Before any token, layout, or
animation, answer in one sentence: *what is the user trying to finish, and what
is the shortest honest path to done?* If a decision doesn't shorten that path or
make it clearer, it is decoration — cut it.

When craft and the job conflict, the job wins. When two solutions serve the job
equally, take the quieter one.

---

## 1. Principles

These are checkable, and **ordered by importance — most important first.**
Each one can be failed by a specific screen. Where two used to overlap, they've
been merged into one.

**1. Solve the job to be done.** Before any token, layout, or animation, answer
in one sentence: what is the user trying to finish, and what is the shortest
honest path to done? If a decision doesn't shorten that path or make it
clearer, it is decoration — cut it. When craft and the job conflict, the job
wins. This is the rule above all the others in this file; everything below is
in service of it.

**2. Achieve the goal — with ease, simplicity, and honesty.** A screen almost
always carries more than one kind of goal, and they're rarely the same thing:
the **user's goal** (the task they came to finish), the **business goal**
(conversion, retention, revenue), the **organization's goal** (policy,
compliance, brand consistency), and sometimes a **personal goal** (a
stakeholder's preference, a team convention). Name each one that's in play on
a given screen, then rank them explicitly — don't let them default to whatever
order they were requested in. The user's goal is the default top priority,
because Principle 1 already says the job to be done comes first, and a product
that doesn't help the user finish their task won't stay around to serve the
other goals either. When a lower-ranked goal — an upsell, a policy notice, a
data request — would compete with the top one for attention, it steps back:
smaller, quieter, later, never the reverse. A screen where five goals fight for
the same visual weight serves none of them.

**3. One hierarchy, one emphasis.** Exactly one thing is the most important
thing, and it carries the only strong emphasis on the screen — the largest
type, the highest contrast, or the only motion, not all three at once.
Everything else steps down in a visible order and nothing else competes with
it. If a stranger can't name the most important element in two seconds, or if
two elements are both shouting for attention, this principle has failed.

**4. Clear start, clear end.** Every experience has one unmistakable starting
point that puts the user on a legible path toward a clear endpoint — completing
the job to be done. A landing page or home screen is a clear start: from it,
the user can see and reach their primary goal, and any secondary goals,
without guessing where to look. The end matters just as much — an order
confirmed, a message sent, a file saved — and should be just as unambiguous,
so the user always knows whether they finished. Home stays reachable from
anywhere, in the same place on every screen (top-left), as the fallback clear
start whenever a specific path gets lost.

**5. Be honest.** Show what's actually happening, accurately — informative,
warning, problem, or success, whichever it genuinely is. Never soften a failure
into something that reads as neutral, and never dress up an ordinary result as
a triumph. Clear, accurate information is what lets a user make the right
judgment and take the right next action; honesty here is a usability
requirement, not a tone preference.

**6. Respect the gaze.** Western reading is left→right, top→bottom. Titles and
identity go top-left. Global and account actions go top-right. Within a form or
card, the label precedes the value; the confirming action sits at the end of the
reading path (bottom-right or the far right of a row). Never make the eye
backtrack to find the next step.

**7. Everything comprehensible.** Plain words over clever ones. A label is a
verb phrase describing the outcome ("Save changes", not "Submit"). Icon-only
controls require a tooltip *and* an accessible name. No jargon the user didn't
bring.

**8. Nothing invisible.** No element that does something may be indistinguishable
from an element that does nothing. Every interactive thing has a visible
affordance at rest — not only on hover. Hover-only reveals are forbidden on
anything a user must find; they may only *enhance* something already discoverable.

**9. Color carries meaning, never mood.** Green = succeeded. Amber = needs
attention, not yet broken. Red = failed, destructive, or genuinely urgent.
Nothing else is colored. A red thing must always be a real problem, or red stops
working.

**10. Space is your friend.** Group with distance first: things placed close
together read as related, things placed apart read as unrelated — this is the
default tool, because it costs nothing and never goes stale. Two other tools
exist alongside it, both used deliberately, never by default:

A **line** — a hairline divider — earns its place when the separation is
genuinely purposeful and worth stating outright: a table's rows, a dense
settings list, the boundary between a form and its footer. Used with real
intent, a divider is a legitimate, permanent part of this system; used to
decorate a gap that spacing already communicates, it's noise. The test doesn't
change: if the groups are still readable with the line hidden, the line wasn't
doing the separating — remove it.

A **solid box** — a card or panel with a rounded corner and a filled
background, not an outline — earns its place when several elements genuinely
belong to one object: a record, a message, a product, a settings section with
its own name. Show that boundary with a fill difference, or — over dynamic
background content — a subtle blur; reach for an outlined box only when you
deliberately want the grouping itself to draw the eye. A box wrapped around a
cluster of otherwise-independent controls "to be safe" is the same mistake as
a decorative divider: increase the gap around the cluster instead.

Used well, spacing gives an interface breathing room: it lets the eye rest on
the one thing that matters, makes hierarchy and grouping legible without
spending a single pixel of ink, and keeps a screen from overwhelming the user
with information they didn't ask for. When in doubt, reach for space before a
line or a box.

Spacing is also a language, and like any language it only works if it's spoken
consistently. A user learns, without ever being told, that this app groups
things 8px apart and separates them 32px apart — and once they've learned that,
every gap on every screen is either confirming what they already know or
quietly contradicting it. Use the same spacing scale for the same kind of
relationship everywhere in the product, not a slightly different rhythm per
screen. And every gap should have a legible reason for its size — not "this
felt about right," but "these two things are unrelated" or "this group is
denser because it's a data table." If you can't say in one sentence why a gap
is the size it is, it's probably an accident, and accidents are what erode the
language over time.

**11. Nothing moves.** A control occupies the same position and the same box in
every state — default, hover, press, disabled, loading, error. Loading does not
shrink a button. An error message does not shove the submit button down; reserve
its space. Users should learn where a thing is once, forever. The only permitted
transform is `scale(0.98)` on press, which changes nothing about layout.

**12. Immediate feedback.** Visual response to input within 100ms, always. Under
1s, no spinner — just do it. 1–3s, indeterminate spinner in place. Over 3s,
determinate progress with real numbers. Never fake a progress bar.

**13. Reversible by default.** Prefer undo over confirm. Destructive actions get
either a 5-second undo toast or an explicit confirmation — never both, never
neither. Provide a back affordance on any multi-step flow. Autosave drafts;
losing user input is the most expensive failure in the system.

**14. No dead ends.** Every state has a way forward and a way back. A
persistent header or footer with a route home counts as a way back, and so does
a clear home screen (Principle 4) — a dead end is only truly dead if there's no
path out of it anywhere on the screen. Empty states name the thing that's
missing and offer the action that fills it. Errors say what happened, why, and
the one thing to do next.

**15. Guard the irreversible.** Actions that cannot be undone (delete forever,
send, publish, pay) must look unmistakably dangerous — the Danger color family,
never a neutral button style — and carry a clear tooltip or adjacent text
stating the actual consequence, not just the action's name. It must never be
the default-focused control, and it must require a deliberate second act —
typing the name, holding to confirm, or a dialog whose confirm button is not
pre-focused. Rapid double-click must never fire it twice.

**16. Motion has a job.** Animate to explain a relationship (where this came
from, where it went), to confirm a touch, or to hold attention during a wait.
Never to decorate. Nothing on the page moves unless the user caused it or is
waiting on it.

**17. No shouting.** Never set text to all caps as a styling choice. Capitals-
as-emphasis is a typographic trick from an era of fewer weights and sizes —
this system has both, so use weight, size, or color instead. The exception is
capitalization that's inherent to the text itself rather than applied for
effect: proper nouns, acronyms, and file names — `SKILL.md`, LOL, API — are
spelled the way they're spelled, sitting inside otherwise sentence-case copy.
That isn't shouting; it's just correct.

**18. Maximize your use of space — where precision rewards it.** Some elements
get more *usable*, not just more comfortable, the more room they're given: a
slider or color picker is easier to control with a longer track; an image,
video, or canvas preview is easier to judge and work with at the largest
reasonable size. For these, don't cap the size to match a neighboring label or
shrink it "to be tidy" — let it take the maximum row length, column length, or
canvas area available. This sits in productive tension with Principle 10: use
generous space to separate and group, and use maximum space for the handful of
elements whose job is control or presentation of the primary content.

**19. Remove the step.** Every screen, field, click, and confirmation must earn
itself. Default to sensible defaults. Ask for nothing you can infer. Prefer one
long obvious page to four short mysterious ones.

**20. Understandable without a tutorial.** If a flow needs an onboarding overlay
to make sense, redesign the flow. Coach marks are an admission of failure.

**21. Same everywhere.** Shape, color, layout, line weight, and type are
identical across every project. A user who learns one product knows the next.

**22. Adapt, never redesign.** The same product on a watch, a phone, a desktop,
and a TV is recognisably one product. Surfaces differ in how much is visible and
how it's reached — never in what things mean or what they're called. Design
against input modality, viewing distance, canvas size, and attention budget, not
against a list of devices. Detect capability, never device.

**23. Spend the attention budget deliberately.** Every element taxes every other
element. Assign each one a tier: always visible, one interaction away, in a
dedicated place, or deleted. Hide *content*, never the affordance that reveals
it — a "More" button is always visible; what's inside it is not. Cost,
consequence, permissions, current state, and anything required are never
disclosed, and nothing is ever hidden because it's unflattering.

**24. Nothing is lost when the surface changes.** Rotating, folding, resizing,
switching from trackpad to touch, or moving between windows must preserve scroll
position, selection, input, playback, and focus. This is Principle 13 applied to
hardware, and it's the most commonly broken rule in this file.

**25. The window is exactly as big as its content.** Don't reserve space "in
case" content grows, and don't center a small amount of content inside a large
canvas. If a view has less content than the window, shrink the window —
especially for widgets, panels, and utility surfaces, which should hug their
content on every edge. Leftover whitespace at the bottom or right edge of a
window is not calm, it's unfinished sizing.

---

## 2. Tokens

Load `tokens/tokens.css`. Set `data-theme="light" | "dark"` on `<html>`, or omit
it to follow the OS. Use the Tailwind preset at `tokens/tailwind.preset.js`.
Import `tokens/tokens.json` into Figma as Variables (Light/Dark modes).

**Never write a hex value in a component.** If a color you need doesn't exist as
a semantic token, the design is wrong or the system needs a considered addition.

### Surfaces

| | Light | Dark |
|---|---|---|
| Page | `#FFFFFF` — the brightest white | `#0E0E10` — very dark gray, never pure black |
| Raised (cards, grouping boxes) | `#FFFFFF` + `e1` shadow, no border | `#18181B` + hairline |
| Sunken (wells) | `#F7F7F8` | `#09090B` |
| Control (inputs, selects, search) | `#F7F7F8`, no border at rest | `#09090B`–ish, no border at rest |
| Overlay (menus, modals) | `#FFFFFF` + `e2`/`e3` shadow | `#1C1C20` + hairline |

Light mode expresses depth with **shadow**. Dark mode expresses depth with
**surface lightness plus a hairline** — shadows barely read on dark, so a raised
thing gets lighter, and it's the one place a border is genuinely doing a job a
fill can't: without it, a raised surface at nearly the same lightness as the
page behind it would be unreadable in the one theme where shadow can't help.
This is the model for every border exception in the system — a line earns its
place only where fill and shadow together can't carry the boundary alone.

**Grouping boxes use this same language.** A card or panel that groups several
elements together (Principle 10) is a Raised surface: shown by its fill and
shadow in light mode, by its lightness and hairline in dark — never by an
outline layered on top for emphasis. Reserve an actual outlined box for the
rare moment the grouping itself should draw the eye, not as the default way a
card reads as a card.

**Materials.** The system is opaque, with exactly one exception:
`--surface-chrome`, a 72% translucent surface over a 24px background blur, used
only for OS-level chrome — sidebars, toolbars, sheets. 72% is the floor at which
text on top still clears 4.5:1 over arbitrary scrolling content; don't lower it.
This is also the answer whenever a grouping box sits over dynamic background
content instead of the flat page: reach for `--surface-chrome`'s blur rather
than a border to separate it. Everything else stays opaque, because contrast
should never be a function of what happens to be underneath.

### Type

**Plus Jakarta Sans** (SIL Open Font License), falling back to the system stack.
Weights 400 / 500 / 600 only; there is no bold in the UI.

Tracking tightens as size increases — that negative letter-spacing is most of
what makes a ramp read as high-craft. But the values here are ~35% less negative
than an Inter or SF ramp would use: Plus Jakarta is wider and rounder with a
large x-height, and the tighter numbers make it look cramped rather than crafted.
**If you ever swap the typeface, retune the tracking.** Sizes transfer between
faces; tracking does not.

`display 48/52 −0.020` · `h1 32/38 −0.014` · `h2 24/30 −0.012` ·
`h3 20/26 −0.009` · `title 17/24 −0.006` · `body-lg 17/26 −0.006` ·
`body 15/22 −0.004` · `label 14/20 −0.002` · `caption 13/18 0` ·
`micro 11/14 +0.020`

In Figma the weight strings are `Regular` / `Medium` / `SemiBold` — note
`SemiBold` has no space, unlike Inter's `Semi Bold`. Loading the wrong string
throws on first write.

Body copy caps at ~72 characters per line. Never center more than two lines of text.

**No orphans.** Never leave a single word — or worse, a single letter — alone
on the last line of a paragraph, heading, button label, or table cell. Adjust
the container width, the line length, or the copy itself rather than shipping
a dangling word; it reads as sloppy even when nobody can say exactly why.
The same care applies to headings and card titles that wrap: a two-word
heading breaking 1-word/1-word should almost always break 2/0 instead — check
the wrap at your actual breakpoints, not just the widest one.

**One typographic system, applied consistently.** Every screen draws from the
same ten named steps (display through micro) and only those steps — never a
bracket value, never a size invented for one screen. The same discipline
applies to weight (only 400/500/600 exist), color (text always comes from
`--text-primary/secondary/tertiary/disabled`, never a one-off gray), and
typeface (Plus Jakarta Sans everywhere, no per-feature substitutions).
Consistency here isn't a style preference — it's what lets a user's eye parse
"this is a heading" or "this is secondary text" instantly, without rereading.

**Never all caps.** Sentence case everywhere — headings, labels, buttons, nav
items, table headers. Use `text-label` weight (500) or `text-caption` size to
signal "this is a category/meta label," not capitals. See Principle 17.

### Space, radius, line

4px base scale. **8px grid for layout** — every gap, pad, and offset is a
multiple of 4, and preferably of 8.

Radius: `4` chips, badges, checkboxes, small indicators · **`8` all
controls** — buttons, inputs, selects, menu items · `16` cards, popovers,
modals, and sheets · `9999` pills and avatars. Three steps, each double the
last — chosen because every one of them divides cleanly by the 4px grid. `10`,
the old default, didn't, and it was the one number in the system that never
quite felt settled. A child's radius sits one step down this scale from its
parent's — a 16px card holds children at 8, an 8px control at 4 — which the
doubling makes automatic instead of a calculation.

**One line weight: 1px.** Every border, divider, and outline in every project.
Two weights make a system look assembled by committee.

**Controls are filled, not outlined.** A control's edge is defined by a
visible difference in fill against its background — `--surface-control` sits
a clear, deliberate step off `--surface-page` — not by a line around it. That
fill difference has to clear the same ≥3:1 boundary contrast a border used to
carry; it's a different technique for the same accessibility requirement, not
a relaxation of it. Reserve `--border-control` for the short list of cases
where fill alone genuinely can't do the job: an unchecked checkbox or radio
(too small for fill contrast to read reliably) and a control that has to sit
directly on a surface sharing its own fill. Secondary buttons keep their
border by design — it's their entire affordance, since they carry no fill at
rest. Full exception list and the reasoning behind each one is in
`reference/components.md`.

Three border strengths remain for the cases that do call for a line:
`--border-subtle` dividers, used sparingly (Principle 10) · `--border-default`
the rare card-on-card edge · `--border-strong` a hovered control that already
has a border. `--border-control` is the function-only exception above, not a
default.

### Motion

`fast 120ms` hover/press · `base 180ms` most things · `slow 260ms` modals
arriving · `slower 400ms` route changes.

Easings: `standard cubic-bezier(0.2,0,0,1)` default · `entrance
cubic-bezier(0.16,1,0.3,1)` for things arriving · `exit cubic-bezier(0.4,0,1,1)`
for things leaving. Things leave faster than they arrive.

**Only these properties may animate:** `opacity`, `transform`,
`background-color`, `border-color`, `color`, `box-shadow`, `filter`. Animating
width, height, top, left, margin, or padding is banned — it costs frames and it
moves neighbors.

Always honor `prefers-reduced-motion` (already handled in `tokens.css`).

---

## 3. Buttons — the load-bearing component

Get these right and the rest of the system follows.

| Variant | Light | Dark | When |
|---|---|---|---|
| **Primary** | solid `#0E0E10`, white text | solid `#FFFFFF`, near-black text | The one action this screen exists for. Max one per view. |
| **Secondary** | transparent + 1px border, black text | transparent + 1px border, near-white text | Real alternatives. Cancel, Back, secondary paths. |
| **Tertiary** | text only, **no border ever**; shape appears on hover | same | Low-stakes, repeated, or in-table actions. |
| **Danger** | solid `#B42318` | solid `#D93A3F` | The irreversible act itself, in a confirmation. |
| **Danger Secondary** | red text + red 1px border | red text + red border | A destructive option among others — a row action, a settings entry. |
| **Danger Tertiary** | red text only, no border | same | A destructive item inside a menu or toolbar. |

The danger family carries the same three-level hierarchy as the neutral one, for
the same reason: solid red is a shout, and most destructive actions don't need
one. Reserve the solid for the moment of commitment — the confirm button in the
dialog. Everything leading up to it uses outline or text.

Three levels of red does **not** mean three chances to delete something. There is
still exactly one destructive action per view, and it is still guarded.

**The hover/press law:** hover moves the fill one step *toward the mid-gray*
(black lightens, white dims) — it reads as lifting toward you. Press returns the
fill to its default and applies `scale(0.98)` over 90ms — it reads as pushing
down. Same physical metaphor in both themes, so muscle memory transfers.

Sizes: `sm 32px` · `md 40px` (default) · `lg 48px`. Radius always 10.
Touch targets 44×44 minimum — pad the hit area, don't grow the box.

Every button implements: **default · hover · focus-visible · press · disabled ·
loading · processing · success**. Full state tables, sizing, spinner spec, and
the width-locking technique in `reference/components.md`.

**Tertiary carries no border at all** — not even a transparent one. Primary,
secondary and danger keep a 1px border (transparent when unused) so they share
identical outer dimensions; tertiary is deliberately weightless. Its entire
affordance is typography: the label sits one weight step above body text, at
semibold. That reads as actionable the way a link does, without borrowing a box
it doesn't have. The 10px shape fades in on hover — the same radius as every
other control, so the ghost button is revealed as *the same object* the others
are.

Two non-negotiables:

- **The box never resizes.** Loading swaps the label for a spinner *inside the
  same box* — lock the width, don't let the label collapse.
- **Disabled is never silent.** A disabled control must be accompanied by the
  reason it's disabled. Prefer an enabled button that explains the problem on
  click over a dead one that explains nothing.

---

## 4. Layout

- Containers: `720` reading/forms · `1200` app shell · `1400` dashboards & tables.
- Page padding: 16 mobile / 24 tablet / 32 desktop. Gutters 24.
- Vertical rhythm: 8 within a group, 16 between related groups, 32 between
  sections, 64 between major regions. Section spacing should be visibly larger
  than the spacing inside a section — that gap *is* the grouping.
- **Top-left**: identity + home. **Top-right**: global actions, search, account.
  Same on every screen of every product.
- Forms: single column. Labels above fields. Related fields grouped with 16;
  groups separated by 32. Commit action bottom-right of the form, destructive
  action pushed to the far left with ≥24px of separation.
- Density: prefer whitespace over borders, and grouping over dividers. If a
  screen feels busy, the fix is almost always fewer elements, not smaller ones.

### Grouping: space first, then lines and boxes with intent

Default tool for grouping is the gap. Step the gap in discrete jumps — 8
inside a group, 16 between related groups, 32 between sections — so the size
of a gap is always legible as a statement about the relationship, not a random
value that happened to fit.

A hairline divider is not banned — it's a tool for when the separation is
genuinely purposeful and worth stating outright: a table's rows, a dense
settings list, the line between a form and its footer actions. Use it there
without hesitation. What it isn't for is decorating a gap that's already
visibly a gap — a divider between two sections already 32px apart adds a line
without adding information. Before placing one, name the reason in a sentence;
if you can't, it's decoration.

A solid box — a card or panel, rounded corner, filled background — is the
other purposeful grouping tool, and the one to reach for when several elements
are genuinely one object: a record, a message, an item in a list, a named
settings section. Show the box's edge with a fill difference against its
background (or a subtle blur if it sits over dynamic content — see Materials
in §2), not an outline; save an outlined box for the rare moment you want the
grouping itself to be the thing that draws the eye. A toolbar of five buttons
doesn't need a panel behind it — the gap before and after it already says
"these five belong together, and nothing else does." Before adding a box, ask
whether a fill difference and the surrounding gap would do the same job. It
usually does; when it doesn't, that's exactly when a box or a line is earning
its place rather than decorating one.

### Alignment and consistency within one page

Every control on the same page shares a grid: pick one column width for
dropdowns, selects, and text inputs that appear near each other and hold it,
even if one field's content is shorter. Don't let a select shrink-to-fit its
current value while its neighbor is full width — a page where every dropdown
in a form or toolbar is a different width reads as unfinished. Align left
edges of labels, left edges of fields, and right edges of trailing actions
across every row; a field that's 4px off the column above it is a visible
defect, not a rounding error.

### Sliders and other room-hungry controls

Give sliders the full width of their row or container rather than a fixed
short track — more length means finer control and an easier target, and it
costs nothing on a canvas class that has the room (`expanded` and up).
Compact/mobile canvases may still need a shorter track; scale it down there,
not on desktop by default. The same applies to any control whose usability
scales with its physical size — segmented controls, horizontal steppers.

### Window and canvas sizing

Size the window, panel, or widget to its content, not the reverse. A widget
or utility window with 200px of content in a 400px canvas is a sizing bug —
shrink the canvas so the content's own bottom and trailing edges *are* the
window's edges, at the standard page padding. This applies most to widgets,
popovers, panels, and any surface the user can resize or that renders at an
intrinsic size (OS widgets, browser extension popups, floating panels) — grow
or shrink the container with its content rather than reserving fixed space
"just in case." App shells with a fixed viewport (a full browser window, a
phone screen) are the exception: there, unused vertical space at the bottom
of a short page should be filled by pushing footer/secondary content down or
by centering the content block — not left as dead air, and not solved by
inflating element sizes to reach the bottom.

Screen-level patterns (app shell, empty states, loading, error, confirmation
dialogs) are specified in `reference/components.md`.

---

## 5. Surfaces

One system, adapted — never redesigned. Full rules in `reference/surfaces.md`.

**Design against four axes, not a device list:** input modality (pointer · touch
· both · directional · rotary), viewing distance (30cm wrist → 3m TV), canvas
class, and attention budget. Every device — including ones that don't exist yet —
is a point in that space.

**Canvas classes.** `micro` <320 · `compact` 320–599 · `medium` 600–839 ·
`expanded` 840–1199 · `large` 1200–1599 · `xlarge` ≥1600. A class change should
*add or rearrange* content, never merely stretch it. If a breakpoint only changes
padding, it didn't need to exist.

**Targets by modality.** Pointer 32px · **touch 44×44** · directional (TV) 56px.
`tokens.css` raises `--control-h-*` automatically under
`@media (any-pointer: coarse)` — so a touch laptop with a mouse attached still
gets touch-sized targets. Grow the *hit area*, never the visible box.

**Hover is an enhancement, never a channel.** Roughly half of sessions have no
hover at all. Nothing may be discoverable only on hover, only by gesture, or only
in a tooltip. In Tailwind always write `can-hover:hover:` — a bare `hover:`
latches after a tap on touch and leaves the control looking permanently hovered.

**Type follows viewing distance.** Set `data-surface="tv"` or `"watch"` on the
root and only sizes change — weights, tracking, color, and radius are untouched,
so every surface still reads as the same family. Floors: 13 on the wrist, 12 at a
desk, 18 at three metres.

**Two documented exceptions to "nothing moves":** on TV, the focused element
scales to `1.06` because focus *is* the cursor and must be legible at three
metres. And a user-requested disclosure may animate its own height — but the
trigger must stay exactly where it was.

**What changes mid-session is what breaks.** Fold, rotate, resize, detach,
switch from trackpad to touch — each must preserve scroll, selection, input,
playback, and focus.

---

## 6. How much to show

Full rules in `reference/disclosure.md`.

Every element spends from one fixed budget: the user's attention. Assign each
one a tier — **always visible** (5–7 max, one of them the primary action) ·
**one interaction away** (behind a visible, labeled control) · **in a dedicated
place** (settings, admin — a place with a name) · **deleted**.

**The cardinal rule: disclosure hides content, never the affordance that reveals
it.** The "More" button is always visible; what's inside it is not. The moment
the entry point disappears, you've stopped doing disclosure and started violating
Principle 8.

**Never disclosed, at any density:** cost, consequence, what data is collected,
what permission is granted, current state (saved/failed/offline), anything
required, and anything that failed. And never hide something *because* it's
unflattering — disclosure manages complexity, not accountability.

**Density budget** — simultaneously visible interactive elements: micro 1 ·
compact ≤5 · medium ≤9 · desktop ≤15 · TV ≤5 per row. Exceed one and you owe a
disclosure decision. The primary-action count is `1` at every size: more canvas
buys more content, never a second emphasis.

**Grouping:** by user intent, never by your architecture. ≤7 per group, one level
of nesting, most-used first, destructive last and separated. Every group gets a
noun phrase naming its outcome — never "Other" or "Misc", which is a confession
that the domain isn't understood yet. Never reorder by recency; a menu's value is
that it's the same tomorrow.

---

## 7. Accessibility — the floor, not a feature

- Body text ≥ 4.5:1. Large text and UI boundaries ≥ 3:1. Verify, don't estimate.
- Never color alone. Every status color pairs with an icon or a word.
- Focus is always visible: 2px ring, 2px offset, `--focus-ring`. Never `outline: none`.
- Full keyboard operation. Logical tab order. Escape closes. Enter commits.
  Focus traps in modals; focus returns to the trigger on close.
- Every icon-only control has an accessible name.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Touch targets ≥44×44; directional-navigation targets ≥56px.
- Every element reachable by keyboard, and — where directional navigation
  applies — by up/down/left/right, with no traps and no unreachable corners.

---

## 8. Using this system

**In code (React + Tailwind).** Import `tokens/tokens.css` at the app entry, add
the preset to `tailwind.config.js`, put `data-theme` on `<html>` (plus
`data-surface` for TV, watch, or widget). Then build only from semantic classes:
`bg-page`, `text-fg-secondary`, `border-line`, `rounded-control`, `h-control-md`,
`p-page`. If you type a bracket value like `text-[15px]`, you've left the system.

Capability variants come with the preset: `can-hover:` · `touch:` · `fine:` ·
`tv:` · `watch:` · `widget:` · `folded-h:` · `reduced-motion:`. Branch on those,
never on a device check.

**In Figma.** Import `tokens/tokens.json` as Variables — `semantic` becomes a
collection with Light and Dark modes, so a frame flips themes by switching mode.
Build component sets whose variants are the *states* above, and bind every fill,
stroke, and radius to a variable. Never a raw hex on a layer.

**Always instance the library — never redraw.** The Minimal Figma file is a
published library (Button, Input, Selection Controls, Card, Badge, Dialog,
Messaging, Overlays, Chrome, Controls, Icons, Illustrations, Navigation,
Elements). Any new Figma file consuming this system should **subscribe to that
library** (Assets panel → Libraries) and place *instances* of its components,
not freehand rectangles and text that merely resemble them. A hand-drawn button
that looks right today silently drifts the moment the library updates; an
instance updates itself. If a screen needs a component the library doesn't
have yet, that's a signal to add it to the library first — via
`figma-generate-library` — rather than to one-off it inside a product file.
Same rule for icons and illustrations: drag the named `icon/*` or
`illustration/*` component in, don't redraw the glyph.

**In specs and prompts.** Don't restate visual rules — reference this system and
spend the words on the job to be done. Use `reference/spec-template.md`. A spec
that says "primary button" is shorter *and* more precise than three sentences
describing black rounded rectangles, because the token behind it is already
settled.

**Before shipping.** Run `reference/checklist.md`. It's the principles above
turned into pass/fail questions.

---

## 9. Design crit — run this after every implementation

Building the screen is not the last step. After implementing any UI against
this system — a new screen, a meaningful edit to an existing one — run a crit
pass before calling it done. Full checklist in `reference/design-crit.md`;
short form:

1. **Re-read the screen cold**, as if seeing it for the first time. Name the
   one thing it's for. If you can't in one sentence, Principle 1 failed.
2. **Walk every principle in §1 against this specific screen**, not in the
   abstract — "does *this* button move," "is there all caps *anywhere on this
   screen*," "are these two dropdowns the same width." A principle that isn't
   checked against the actual pixels doesn't catch anything.
3. **Look for anything that can be deleted.** A container that isn't holding
   one object, a divider next to a gap that already reads as separate, a label
   restating what the field already shows, a second visual weight competing
   with the primary action. Removing something and confirming nothing broke is
   the single highest-value move in a crit.
4. **Look for anything that can be enlarged or simplified instead of added.**
   Could this slider take the full row? Could two steps become one field? Could
   the empty space at the bottom of the window instead be the window's edge?
5. **Act on what you find.** A crit that produces a list but no edits was a
   waste of a pass — fix what's found, then confirm the fix didn't introduce a
   new violation elsewhere (a wider dropdown that now collides with its
   neighbor, for instance).
6. **Re-run once.** If the second pass finds nothing, stop — a system this
   constrained converges fast, and hunting for a fourth or fifth issue past
   that point is usually second-guessing, not craft.

This applies to every surface, not just Figma: a generated React screen, a
spec document, a component built in code — all get the same cold read before
they're considered finished.

---

## 10. Changing the system

Add a token only when a real product need has no expression in the current set,
and add it as a *semantic* token, never a one-off primitive. Adding a color
requires deleting one or justifying why the system needed more color. Adding a
line weight or a radius value is almost always a mistake — the constraint is the
product.

**A new surface is not a new system.** When something genuinely new arrives —
another form factor, another input — place it on the four axes and it should
already be covered. If it isn't, extend an axis. Never fork the system.

---

## Reference files

- `reference/components.md` — every component, every state, with values.
- `reference/motion.md` — the interaction contract. Hover, press, focus and
  timing for every interactive element. **Read before building any control.**
- `reference/design-crit.md` — the post-implementation review pass. Run this
  after building any screen, before calling it done.
- `reference/icons-and-illustrations.md` — the 221-icon set, the 31 line-art
  illustrations, the three line weights, and when icon-only is allowed.
- `reference/sizing.md` — small/medium/large across every family, and which type
  step to use where.
- `reference/taxonomy.md` — which component to reach for when platforms disagree
  on the name. Read this before building a new one.
- `reference/surfaces.md` — how the system adapts across every screen and input.
- `reference/disclosure.md` — how much to show, and where the rest lives.
- `reference/checklist.md` — the pre-ship design review.
- `reference/spec-template.md` — scaffold for product specs and build prompts.
- `LICENSE-AND-ASSETS.md` — provenance and licensing. Everything is free for
  commercial use and redistribution; the icon set is original work.
- `tokens/tokens.css` · `tokens/tokens.json` · `tokens/tailwind.preset.js`
