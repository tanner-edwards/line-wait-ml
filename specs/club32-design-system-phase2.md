# Club 32 — Design System · Phase 2: Primitives

## For Claude Code

Phase 1 (tokens) is done. This phase builds the shared component primitives the whole app composes from. Today these patterns are hand-rolled and duplicated across many files; this phase replaces them with single, reusable, **token-driven** components (use Phase 1 tokens only — zero new hardcoded colors).

**Suggested pacing:** do **#1 (BottomSheet) as its own session** — it's the largest and touches 6+ existing sheets. Then **#2–#6 can be one session together** — they're small and independent.

As you build each primitive, migrate its call sites and **delete the old implementation** once migrated. The app's behavior should not change, except the intended consistency gains.

---

## 1. BottomSheet — do this first, on its own

### Hand-roll it. Do not use @gorhom/bottom-sheet.

The app's primary test surface is the **PWA** (web). `@gorhom/bottom-sheet` is native-first — its web support is experimental and a real regression risk on the thing we actually use. The current `PanResponder` + `Animated` approach works well on web. Stick with it; just extract it into one shared component.

**When the app moves to native** (Expo Go / dev build), that's the right time to swap the implementation for `@gorhom`. The `Sheet` API designed here is intentionally swappable — call sites won't change.

### Future: swap to @gorhom when going native

When the app transitions to a native build (Expo dev client / production binary), replace the hand-rolled implementation with **`@gorhom/bottom-sheet` v5**. That library runs gesture and animation on the UI thread via Reanimated, handles keyboard avoidance, and gets accessibility right — all things the hand-rolled version won't bother solving because the PWA doesn't need them. Because `Sheet`'s API is stable, the swap is an implementation change only: update the internals of `Sheet.tsx`, delete the PanResponder code, wire up `GestureHandlerRootView` + `BottomSheetModalProvider` at the app root, and call sites stay untouched.

### Sharp edges to dodge (hand-rolled, PWA phase only)

**No drag-between-snap-points.** Multi-snap dragging is the specific thing that's hard to nail by hand. These sheets don't need it. `size` presets map to **fixed heights** — `half` is a constant pixel/percent value, `tall` is another. The gesture handler supports one behavior only: drag down past a threshold → dismiss. No snapping between sizes.

**Scroll-inside-sheet is the canary.** `NotificationHistorySheet` has a `FlatList` inside a draggable container — this is the hardest interaction to get right on web (scroll vs. drag gesture conflict). Migrate it first and verify it scrolls cleanly. If it's fine, the rest will be.

### What to build

A single `Sheet` component (hand-rolled, `PanResponder` + `Animated.Value`) that bakes in Club 32 styling so no screen styles a sheet itself again:

- **Surface:** `surface` token; top corners `radius.sheet` (24); `shadow.sheet`.
- **Grabber:** styled drag pill using token colors.
- **Backdrop:** `rgba(0,0,0,0.4)` dim + tap-to-dismiss `Pressable`.
- **Header slot:** optional `title` (`cardTitle` style) + optional close `✕` button + optional `headerRight` slot.
- **Safe area:** bottom inset padding handled internally.
- **Scrollable content:** accept a `scrollable` boolean prop; when true, render children inside a plain `ScrollView` / pass through a `FlatList` render-prop so the scroll gesture is properly separated from the drag gesture.

**Props:** `isOpen` / `onClose`, `dismissable` (default `true`; `false` for onboarding DailyPark so it can't be swiped away), `size` presets (`half` | `tall`) as fixed heights — `half` ≈ 50%, `tall` ≈ 75–90%; no mid-gesture snapping between them, `title`, `headerRight`, `scrollable`, `children`.

### Migrate these to it
- `NotificationHistorySheet` (scrollable list)
- `NotificationSettingsModal`
- `DailyParkSheet` (`dismissable={false}` in onboarding, `true` from Profile)
- `PersonaFieldModal`
- `PickerSheet` (debug)
- `SortMenu` — judgment call: if it's currently a small dropdown/popover, leave it as a menu; only fold it in if it's actually a sheet today.

### Flagged decision — RideDetailModal (do NOT migrate blind)
It's full-screen today. It's a strong candidate to become a `tall` Sheet (~90% snap) so it keeps the flick-down-to-dismiss feel instead of feeling like a hard page jump. **But that changes navigation behavior.** So: build the `tall` variant capability now, but leave the actual RideDetailModal migration as a separate, flagged step — when we do it, preserve all its content (trend graph, p10–p90 band, right-now-vs-typical tile, closure tile) exactly and change only the container. Leave a `// TODO: migrate to tall Sheet (needs review)` and stop there.

---

## 2. Badge / Pill

One component; variants map straight to tokens:

| `variant` | text / bg |
|---|---|
| `go` | `go` / `go-bg` (Below Normal, GO) |
| `skip` | `skip` / `skip-bg` (Above Normal, SKIP) |
| `star` | `star` / `star-bg` (rare opportunity) |
| `neutral` | `text-tertiary` / transparent |

**Props:** `variant`, `size` (`sm` | `md`), optional leading `icon`/glyph, `label`. Text uses the `badge` style (uppercase, 0.07em). **Variants are mutually exclusive** — a ride shows one badge, never stacked.

Replaces: `RecommendationBadge`, `BelowNormalBadge`, and every inline pill.

---

## 3. Card

Base card: `surface` bg, `border`, `radius.card` (16), `shadow.card`, padding 16.

**Props:** `variant` (`default` | `highlight` | `flat`), optional `accent` (left-border status color), `children`.
- `highlight` — subtle status wash (e.g. `go-bg` gradient) + colored left accent border; this is the "below normal" treatment.
- `flat` — no shadow (debug card).

Build the base + variants only. The ride row, rec card, and upcoming-window card are Phase 3 compositions of this — don't build those here.

---

## 4. SectionHeader

Uppercase small label with optional right-aligned action.
**Props:** `title`, optional `action` (`{ label, onPress }`). Uses `caption`/`badge` style.
Replaces the section labels in Recommendations sections, Profile, and notification-detail tiles.

---

## 5. TapEditRow

A tappable row: `label` + current `value` + chevron.
**Props:** `label`, `value`, `onPress`, optional `icon`.
Replaces the repeated rows in Profile + NotificationSettings.

---

## 6. GradientHeader

The Park Horizon band. `expo-linear-gradient` (installed in Phase 1), `gradient-from` → `gradient-to`, ~140°.
**Props:** `title` (`screenTitle` style, `text-inverse`), optional `subtitle`/location line (`text-inverse-muted`), optional `right` slot (Change button / `NotificationBellButton`).
Used on Home, Recommendations, and Profile headers.

---

## Acceptance criteria

- [ ] One `Sheet` primitive; every listed sheet migrated; old per-sheet backdrop/grabber/dismiss code deleted.
- [ ] `BottomSheetModalProvider` + `GestureHandlerRootView` wired at the root.
- [ ] One each of Badge, Card, SectionHeader, TapEditRow, GradientHeader — all token-driven, zero new hardcoded colors.
- [ ] App behavior unchanged apart from sheet-consistency gains.
- [ ] RideDetailModal left as a flagged TODO, not migrated blind.
- [ ] List of any call sites you couldn't cleanly migrate, with reasons.

---

## Next — Phase 3 (context only)

Compose these primitives into the full ride row, rec card, onboarding shell (`OnboardingScreenShell` + `ProgressDots`), and the error/empty/loading states (locating, denied, out-of-park, closed, no-data, degraded banner).
