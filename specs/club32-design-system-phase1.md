# Club 32 — Design System · Phase 1: Foundation Tokens

## For Claude Code

You're setting up the visual foundation for **Club 32**, a React Native (Expo) + NativeWind app. Today, colors and text styles are hardcoded inline across 10+ files (e.g. `#4a4ec7`, `#c41e3a`, `#fafaff`, `#888`). This task replaces that scatter with one centralized token system based on the chosen visual direction, "Park Horizon."

**Scope of this task: tokens only.** Do NOT build, refactor, or restyle components yet — that is Phase 2. The single goal here: every color, font, spacing, and radius value lives in one place, and the existing hardcoded values are swapped for token references **with no behavior or layout change**. If a screen looks slightly different because a hardcoded color was close-but-not-exact to its new token, that's expected and fine. Do not redesign anything.

---

## Visual direction (context, not instructions)

Light app. White cards floating on a soft blue-white background. Screen/section headers use a blue→purple gradient band ("Park Horizon"). A warm serif (Lora) for screen titles and ride names; a clean sans (Outfit) for everything else. Status is communicated by color, not decoration: green = good / below-normal, red = above-normal, gold = rare opportunity, neutral = steady.

---

## 1. Install fonts

```bash
npx expo install @expo-google-fonts/lora @expo-google-fonts/outfit expo-font expo-linear-gradient
```

> `expo-linear-gradient` is installed now because the gradient header (Phase 2) needs it; you won't use it in this task.

Load fonts at the app root and block render until ready (use the existing splash/loading state). Register these weights:

- **Lora**: `Lora_600SemiBold`, `Lora_700Bold`
- **Outfit**: `Outfit_400Regular`, `Outfit_500Medium`, `Outfit_600SemiBold`, `Outfit_700Bold`

Verify current package versions and the exact NativeWind font-mapping syntax against the installed NativeWind major version before wiring `fontFamily` (below) — adapt if the API differs.

---

## 2. Color tokens

Define these as the source of truth. Names are semantic (what the color *means*), not literal (what hue it is) — so the palette can shift later without renaming everything.

| Token | Value | Used for |
|---|---|---|
| `brand` | `#4F46E5` | Primary accent: active tab, links, primary buttons |
| `brand-pressed` | `#4338CA` | Pressed/active state of brand elements |
| `gradient-from` | `#0369A1` | Header gradient start (top-left) |
| `gradient-to` | `#7C3AED` | Header gradient end (bottom-right) |
| `bg` | `#F4F6FF` | App background / scroll area behind cards |
| `surface` | `#FFFFFF` | Cards, sheets, elevated surfaces |
| `text-primary` | `#0F0E30` | Ride names, headings, primary numbers |
| `text-secondary` | `#5A5880` | Body copy, descriptions |
| `text-tertiary` | `#9896C0` | Metadata, walk pills, de-emphasized text |
| `text-inverse` | `#FFFFFF` | Text on the gradient header |
| `text-inverse-muted` | `rgba(255,255,255,0.55)` | Secondary text on the gradient |
| `go` | `#059669` | Below-normal / good window / GO badge |
| `go-bg` | `rgba(5,150,105,0.09)` | GO badge background, below-normal card wash |
| `skip` | `#DC2626` | Above-normal / SKIP badge |
| `skip-bg` | `rgba(220,38,38,0.09)` | SKIP badge background |
| `star` | `#F59E0B` | Rare-opportunity (gold) tier |
| `star-bg` | `rgba(245,158,11,0.12)` | Gold tier background |
| `trend-down` | `#059669` | Wait dropping (good) |
| `trend-up` | `#DC2626` | Wait rising (bad) |
| `trend-flat` | `#9896C0` | Steady |
| `border` | `rgba(70,70,200,0.08)` | Card borders, hairlines |
| `border-strong` | `rgba(70,70,200,0.14)` | Emphasized borders, pill outlines |

---

## 3. Old → new mapping (find & replace)

Hunt these hardcoded values across the codebase and replace with the token reference. Search for each hex literal (case-insensitive, with and without the `#`):

| Old hardcoded | New token |
|---|---|
| `#4a4ec7` (brand purple) | `brand` |
| `#c41e3a` (red) | `skip` |
| `#2a8f3e` (green) | `go` |
| `#fafaff` (tile bg) | `bg` |
| `#888` (muted text) | `text-tertiary` |

If you find other inline hexes not in this list, leave a `// TODO: tokenize` comment next to each and list them at the end — don't guess a mapping.

---

## 4. Typography

Two families:
- **Display (serif): Lora** — screen titles and ride/card names only.
- **UI (sans): Outfit** — everything else.

Define these named text styles (as a `Text` preset component, a style map, or NativeWind classes — your call, but centralize them):

| Style | Font | Size | Weight | Notes |
|---|---|---|---|---|
| `screenTitle` | Lora | 27 | 700 | letter-spacing -0.02em |
| `cardTitle` | Lora | 17 | 600 | letter-spacing -0.01em; ride names |
| `waitNumber` | Outfit | 24 | 700 | letter-spacing -0.03em; **tabular figures** |
| `body` | Outfit | 13.5 | 400 | line-height ~1.55; AI copy |
| `label` | Outfit | 12 | 500 | location, metadata |
| `caption` | Outfit | 11 | 500 | trend labels |
| `badge` | Outfit | 10.5 | 700 | UPPERCASE, letter-spacing 0.07em |

Enable tabular/lining figures on `waitNumber` so wait times don't shift width as they change (RN: `fontVariant: ['tabular-nums']`).

---

## 5. Spacing, radius, shadow

**Spacing scale** (4px base): `4, 8, 12, 16, 20, 24, 32, 40`. Default card padding is `16`. Default gap between cards is `10`.

**Radius:** `sm: 8`, `md: 12`, `card: 16`, `sheet: 24` (top corners only), `pill: 9999`.

**Shadow** — define as a shared style object, not a Tailwind class (RN shadows are platform-split: iOS uses `shadowColor/Offset/Radius/Opacity`, Android uses `elevation`):

- `shadow.card`: color `#1E1478` (≈ rgba(30,20,120)), offset `{0,2}`, radius `10`, opacity `0.08`, Android elevation `2`
- `shadow.sheet`: color `#140F50`, offset `{0,-4}`, radius `24`, opacity `0.18`, Android elevation `12`

---

## 6. Wire into NativeWind

Extend `tailwind.config.js` `theme.extend` with `colors`, `fontFamily`, `borderRadius`, and `spacing` from the tokens above so they're usable as utility classes (`bg-surface`, `text-primary`, `rounded-card`, `font-display`, etc.). Keep the raw token values exported from a single TS module too (e.g. `theme/tokens.ts`) so non-className style objects (shadows, gradients, SVG fills) can import them.

---

## 7. Acceptance criteria

- [ ] App builds and runs; fonts load before first paint (no flash of system font).
- [ ] All five old hex values from §3 are gone from the codebase (grep returns nothing).
- [ ] Every remaining inline hex is either tokenized or flagged with `// TODO: tokenize`.
- [ ] Colors, fonts, radii, and spacing are all referenceable from one place.
- [ ] No screen changed layout or behavior — only the source of color/type values moved.
- [ ] A short note at the end listing any un-mapped hexes you found.

---

## Roadmap (NOT this task — for context only)

**Phase 2 — Primitives.** Build/unify the shared components, in this order of value:
1. `BottomSheet` — one implementation (grabber, backdrop, dismiss gesture, safe-area) to replace the 6+ hand-rolled sheets.
2. `Badge` / `Pill` — one component with variants (`go`, `skip`, `star`, `below-normal`, `above-normal`, `neutral`) + size prop; replaces RecommendationBadge, BelowNormalBadge, and inline pills.
3. `Card` — base card (surface, border, radius, shadow, padding) with variants that the ride row, rec card, and upcoming-window card extend.
4. `SectionHeader` — the uppercase small label, unified.
5. `TapEditRow` — shared by Profile and NotificationSettings.
6. `GradientHeader` — the Park Horizon blue→purple band, using `gradient-from`/`gradient-to` + `expo-linear-gradient`.

**Phase 3 — Patterns & states.** Compose primitives into the full ride row, rec card, onboarding shell, and the error/empty/loading states (locating, denied, out-of-park, closed, no-data, degraded banner).
