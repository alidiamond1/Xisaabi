# Dukaan Design System

Contract for every screen. If a page needs something this doc does not cover, extend the shared component (`components/common.tsx`, `components/ui/*`) instead of styling locally.

## 1. Personality

**"Ledger green."** A calm, trustworthy shop ledger with a warm paper feel. It handles people's money, so it is quiet, precise and confident, never flashy.
- Warm off-white paper background, white cards, deep teal-green brand, a single gold accent used sparingly (highlights, "most popular", celebratory moments).
- Numbers are the heroes: big, tabular, well aligned.
- Friendly voice, plain words (`Pay`, `Add product`, not `Submit`/`Create entity`). Many users are non-technical shopkeepers on cheap phones.
- No purple/indigo gradients, no glassmorphism, no emoji as icons. Lucide icons only, stroke 2, one size scale (16/20/24).

## 2. Tokens (defined in `app/globals.css`)

Never hard-code hex. Use semantic tokens or the `brand-*` scale.

| Role | Token / class | Value (oklch) | Notes |
|---|---|---|---|
| Page bg | `bg-background` | 0.977 0.004 85 | warm paper |
| Surface | `bg-card` | white | cards, tables, popovers |
| Text | `text-foreground` | 0.22 0.014 200 | ink, 15:1 on bg |
| Secondary text | `text-muted-foreground` | 0.49 0.012 90 | 5:1 on bg (AA) |
| Border | `border` | 0.915 0.008 85 | hairlines |
| Brand | `bg-primary`, `brand-600` | 0.51 0.095 177 | white text on it = 5.5:1 |
| Brand scale | `brand-50..950` | teal-green | tints for selected rows, active tabs |
| Gold | `bg-gold` | 0.8 0.15 82 | accent only, dark text on it |
| Success / in | `text-success`, `bg-success-soft` | green | money in, paid, online |
| Warning | `text-warning`, `bg-warning-soft` | amber-brown | low stock, expiring, offline |
| Danger / out | `text-danger`, `bg-danger-soft` | red | money out, expired, destructive |
| Info | `text-info`, `bg-info-soft` | blue | neutral info |

Legacy aliases: `indigo-*` maps to `brand-*` and `slate-*` maps to warm neutrals so old classes inherit the brand. **New code uses `brand-*`, `muted`, `border`; do not write `indigo-*`, `slate-*`, `emerald-*`, `red-*`, `amber-*`.**

Dark mode is not shipped (light only). Tokens for `.dark` exist but are unreviewed.

## 3. Typography (next/font in `app/layout.tsx`)

- **Display: Bricolage Grotesque** (`font-display`, auto-applied to h1-h3). Headings, big numbers, brand name.
- **Body/UI: Figtree** (`font-sans`, default). Everything else. Friendly, legible at small sizes, has tabular figures.
- Money and any column of numbers: `tabular-nums` (or `<Money>`). Big totals: `font-display text-3xl font-semibold tracking-tight`.

| Role | Class |
|---|---|
| Page title | `font-display text-2xl font-semibold tracking-tight` (use `PageHeader`) |
| Section title | `font-display text-base/lg font-semibold` |
| Body | `text-sm` (14px) in dense UI, `text-base` (16px) for inputs on mobile |
| Label | `text-sm font-medium` |
| Caption / helper | `text-xs text-muted-foreground` |
| Table header | `text-xs font-semibold uppercase tracking-wide text-muted-foreground` |
| KPI | `font-display text-2xl font-semibold tabular-nums` |

Min 12px anywhere; body line-height 1.5. Inputs are 16px on mobile to stop iOS zoom (`text-base md:text-sm` is built into `Input`).

## 4. Spacing, radius, elevation

- 4px grid. Page gutter `px-3 sm:px-6`; max width `max-w-7xl`; vertical rhythm between blocks `space-y-4` (inside page) / `space-y-6` (launcher-style sections). Card padding `p-4`; dialog `p-5`.
- Radius: controls `rounded-lg` (10px), cards `rounded-xl`, dialogs/hero blocks `rounded-2xl`, pills `rounded-full`.
- Elevation (only three): `shadow-card` (resting card/input), `shadow-pop` (menus, dialogs, hover-lift, hero), none for flat table rows. Never ad-hoc shadows.
- z-index: content 0, sticky header 30, overlays/dialogs 50 (library default), toasts above.

## 5. Density

- Default "comfortable-dense": table rows `py-2.5`, controls 36-40px (Button default `h-9`, Input/Select `h-10`).
- Touch contexts (POS, mobile cards, checkout): targets **>= 44px**, gaps >= 8px. Use `Button size="lg"` (44) or `size="xl"` (56) for primary POS actions.
- Data screens may use `size="sm"` (32px) buttons inside table rows on desktop only; on mobile cards, actions must be 44px.

## 6. Component patterns (all exported from `components/common.tsx`)

**Page header**: `<PageHeader title desc actions back meta />`. One primary action only (brand filled button, right side); secondary actions `variant="outline"`. Detail pages pass `back={{href,label}}`.

**Data table** (the standard list screen):
```tsx
<PageHeader title="Products" actions={<Button><Plus/>Add product</Button>} />
<Panel>
  <Toolbar actions={<Button variant="outline">Export</Button>}>
    <SearchInput value={q} onChange={setQ} placeholder="Search name or barcode" />
    <FilterChips options={[...]} value={f} onChange={setF} />
  </Toolbar>
  <DataTable rows={rows} cols={[...]} onRowClick={open} bulkActions={(sel, clear) => ...} empty={<EmptyState .../>} />
</Panel>
```
- `DataTable` handles loading skeleton (rows `undefined`), empty state, mobile cards (<md), pagination (25/page client-side) and optional bulk selection. Pass `pageSize` to change.
- Right-align numeric columns (`className: "text-right"`). Put row actions in a last column with an empty `header: ""`; stop propagation on action clicks.
- Filters live in the `Toolbar`, never above the panel. Server-side search stays in the page's query.

**Detail page**: `PageHeader` (with `back`, `meta` = `StatusBadge`) then `<DetailLayout main={tabs + panels} side={<Panel><KeyValue items/></Panel>} />`. Side summary sticks on desktop, stacks under main on mobile. Tabs for sub-sections use `?view=` via `APP_TABS` in `app-shell.tsx`.

**Form sheet/drawer**: `Sheet` (right on desktop, full width on mobile) with `SheetHeader`, scrollable body of `FormSection`s or `Field`s, sticky `SheetFooter` with the primary button last. `Field` supplies label, `required` star, `hint`, and `error` (shown under the field, `role=alert`). Validate on blur/submit, never on every keystroke. Disable + spinner on submit (`SubmitButton busy`). Confirm before discarding unsaved changes and before any destructive action (`ConfirmDialog`).

**Stat card**: `<Stat label value sub icon tone />`; 2 per row on mobile, 4 on desktop. Value is the story, sub is context. Color the value only for status (`text-warning`/`text-danger`).

**Status badge**: `<StatusBadge tone="green|amber|red|blue|slate|brand" dot>Text</StatusBadge>` (same as `Pill`). Always text, color is reinforcement. Mapping: green = paid/active/online/in stock, amber = low/expiring/pending/offline, red = expired/refunded/overdue/locked, blue = info, slate = neutral/archived.

**Money**: `<Money cents={n} tone="auto">{formatCents(n, cur)}</Money>`. Tabular nums always. Colors: positive/received `text-success` with leading `+`, negative/owed/spent `text-danger` with `-`. Plain price/total stays ink. Never rely on color alone: keep the sign or a word (`owes`, `paid`).

**Empty state**: icon tile + one-line title + one-line reason + a single CTA that fixes it. Distinguish "no data yet" (CTA: add) from "no results" (CTA: clear filter).

**Loading**: skeletons that match the final layout (`ListSkeleton`, `Skeleton`); no full-page spinners except the auth `FullLoader`. Reserve space to avoid layout shift.

**Banner**: `<Banner tone="danger|warning|info|success" icon>` for page-level notices (trial ending, expired stock). Max 3 stacked; most severe first.

## 7. Navigation

- **Launcher** (`/apps`): greeting, alert banners, "Start selling" hero, KPI strip, apps grouped Sell / Stock / Run the business / Account. Only modules the role+plan allow. New modules: add to `lib/apps.ts` and to `GROUPS` in `app/apps/page.tsx`.
- **App top bar** (`AppShell`): `[module menu: grid icon + current app + chevron] [section tabs] ... [business brand (lg+)] [user menu]`. The module menu is a tile grid of all allowed apps (fast app switching without going home). Tabs collapse to a scrollable strip under the bar on mobile.
- **Breadcrumbs**: automatic on nested routes (`Apps / Module / Details`). Top-level module pages show none; the title is the location.
- **User menu**: name, role, business; Settings and Help (owner); Log out separated and red.
- Every key screen is deep-linkable; filters that matter go in the URL (`?view=`).

## 8. POS rules (`/apps/pos`)

- Full-screen, no AppShell. Left: search (48px) + category chips (44px) + product grid (min tile 112px, 2/3/4 cols). Right (lg+): cart panel 400px. Below lg: bottom bar (56px) opening a bottom sheet cart.
- Tap on a tile adds immediately (no confirm), 100ms press feedback (`active:scale-[0.97]`), in-cart count badge on the tile.
- Cart steppers are 44px. The Pay button is `size="xl"` and always shows the total.
- Scanner: hidden auto-focused input; never steal focus from visible inputs/dialogs. Keep that logic intact.
- Online/offline pill always visible with pending count. Offline is a normal state, not an error.
- Checkout: method tiles >= 80px, quick-cash chips (Exact + round-ups), change shown large in green.
- Speed budget: no animation over 150ms in POS; no blocking spinners for local actions.

## 9. Mobile (375px)

- No horizontal page scroll. Gutter 12px (`px-3`). Tables become stacked cards (first column is the card title). Toolbars wrap; search goes full width.
- Primary action stays reachable: header button or a fixed bottom bar with safe-area padding (`pb-[max(1rem,env(safe-area-inset-bottom))]`).
- Sheets open full width; dialogs use `max-w-[calc(100%-2rem)]`.
- Test every new screen at 375x812 and 1280x800.

## 10. Motion

Subtle and fast. Tokens: 100ms press feedback, 150ms hover/overlay, 180ms page enter (`.page-in`: fade + 4px rise), 200ms sheets. Ease-out in, shorter out. Animate only `transform`/`opacity`. `prefers-reduced-motion` collapses everything (global rule). No decorative loops.

## 11. Accessibility

- Contrast AA: text >= 4.5:1, UI glyphs >= 3:1. Tokens above are pre-checked; check any new pair.
- Focus: global 2px brand ring (`:focus-visible`), never `outline-none` without a replacement ring.
- Icon-only buttons need `aria-label`. Inputs need a visible label (`Field`); placeholder is a hint only.
- Color is never the only signal. Toasts are polite and do not steal focus. Errors use `role=alert`.
- Headings sequential (one h1 per page, from `PageHeader`). Tap targets per section 5.

## 12. Do / Don't

Do
- Build lists with `PageHeader` + `Panel` + `Toolbar` + `DataTable`.
- Use `Money`/`tabular-nums` for every amount; show currency via `formatCents`.
- One primary button per view; keep labels verbs.
- Show empty, loading and error states for every query.
- Use `brand-*`, semantic status tokens, `shadow-card/pop`.
- Keep client components small; fetch with `useQuery` and skip when not needed.

Don't
- Don't use `indigo-*`, `slate-*`, raw hex, ad-hoc shadows, or gradients on surfaces (gradients only in launcher hero, landing hero/CTA, brand mark).
- Don't put `<button>` groups inside `Field` (it wraps a `<label>`); use a `fieldset`/`role=group` with your own heading.
- Don't use emoji as icons or status.
- Don't show raw ids, timestamps in ms, or unformatted cents.
- Don't import `components/app-shell` into public pages (pulls auth code); use `components/brand`.
- Don't add libraries for tables, charts of 5 bars, or date pickers; use native inputs and simple SVG/CSS.

## 13. Performance rules

- Public pages (landing) are server components; only interactive islands (`landing-pricing.tsx`) are client.
- Two font families only, `display: swap`, subset latin. No icon fonts; lucide imports are per-icon.
- Paginate or limit anything that can exceed 50 rows (`DataTable` does 25 by default). Skip queries until needed (`"skip"`).
- Images need explicit dimensions or `aspect-ratio`; use `next/image` for logos when sized.
