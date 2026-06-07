# Club 32 — Design System · Phase 3: Patterns & States

## For Claude Code

Phases 1 (tokens) and 2 (primitives) are done. This phase composes those building blocks into the full patterns the app actually renders — the ride row, rec card, onboarding shell, and every loading/error/empty state. There are no new tokens or new primitive components in this phase; everything here is assembled from what already exists.

**Suggested pacing:**
- **Session A:** RideRow, RecCard, UpcomingWindowCard, NotificationRow (#1–4) — the core data patterns users see every open.
- **Session B:** OnboardingScreenShell + ProgressDots, all error/empty/loading states, RideDetailModal migration (#5–7).

Zero new hardcoded color or style values. Every visual decision references a Phase 1 token.

---

## 1. RideRow (Home / Live Waits list)

The repeating item in the Home tab's scrollable ride list. Uses the `Card` base (Phase 2).

**Layout — two rows inside the card:**

Row 1: `[Ride name]` ←→ `[Wait number + "min" + ChevronRight]`
Row 2: `[Optional Badge + Walk pill]` ←→ `[Trend label + TrendArrow icon]`

**Specs:**
- Ride name: `cardTitle` style (Lora 600, 17px). If a watchlist bell is active, show a `Bell` icon (amber / `star` token) inline after the name.
- Wait number: `waitNumber` style (Outfit 700, 24px, tabular-nums). Color: `go` if badge is below-normal, otherwise `text-primary`.
- Trend: `TrendArrow` component + `caption` label ("Dropping" / "Rising" / "Steady"). Right-aligned under the wait number.
- Badge: `Badge` component (`go` / `skip` / `star` / `neutral`), shown only when one applies — never stacked.
- Walk pill: `Navigation2` icon (11px) + label. Background `border` token at low opacity; text `text-tertiary`.
- Card variant: `highlight` (with left accent border + wash) when badge is `go` or `star`; `default` otherwise.
- Tap: opens RideDetailModal (or the tall Sheet once #7 is done).

**Note on density:** RideRow is more compact than RecCard — it has no AI copy paragraph. Keep vertical padding at 13–14px (vs 16px for RecCard) so the list feels like a list, not a stack of heavy cards.

---

## 2. RecCard (Recommendations tab)

The card in the Recommendations tab. Same structural skeleton as RideRow but fuller — includes AI copy and gets more breathing room.

**Layout:**

Row 1: `[Ride name]` ←→ `[Wait number + "min" + ChevronRight]`
Row 2: `[Optional Badge]` ←→ `[Trend label + TrendArrow icon]`
Row 3: AI copy paragraph (full width)
Row 4: Walk pill (left)

**Specs:**
- Ride name: `cardTitle` (Lora 600, 17px).
- Wait number: `waitNumber` (Outfit 700, 24px, tabular-nums). Color: `go` if below-normal, else `text-primary`.
- Badge: `Badge` component, same rules as RideRow.
- AI copy: `body` style (Outfit 400, 13.5px, line-height 1.55, `text-secondary`). No italic.
- Walk pill: same as RideRow.
- Card padding: 16px (standard). Card variant: `highlight` when go/star, `default` otherwise.
- Tap: opens RideDetailModal.

---

## 3. UpcomingWindowCard (Recommendations — forecast section)

The forward-looking forecast block below the main rec cards. This was WIP — apply the design system consistently but do not redesign its content or logic.

- Use `Card` base (`default` variant, standard padding).
- Ride name: `cardTitle`.
- All text: token-driven (`text-primary`, `text-secondary`, `text-tertiary`).
- Any status color (a time window being highlighted as good): use `go` token.
- `SectionHeader` ("Coming Up" or equivalent label) above the section.
- If there's a small graph or timeline visual inside, leave its logic untouched — only apply token colors to it.

---

## 4. NotificationRow (inside NotificationHistorySheet)

Each row in the notification history list. The sheet itself already exists from Phase 2; this is its list item.

**Layout:** `[Status icon]` `[Ride name (cardTitle weight, smaller — label style)]` `[Timestamp (caption, text-tertiary, right)]`
Below: Message text (`caption` or `body-sm`, `text-secondary`).

**Status icon mapping** (replaces emoji):
| Notification type | Icon | Color |
|---|---|---|
| Reopen / good news | `CircleCheck` | `go` |
| Closure / down | `OctagonX` | `skip` |
| Spike / above normal | `TrendingUp` | `skip` |
| Generic / info | `Bell` | `text-tertiary` |

Tap on a row: opens RideDetailModal for that ride.

---

## 5. OnboardingScreenShell + ProgressDots

The wrapper used by every onboarding step (TripDuration, YoungestAge, RidePreferences, MustDoRides, AccessibilityNeeds).

**ProgressDots:**
- N dots for N steps. Completed + current: `brand` color, filled. Upcoming: `border-strong`, empty.
- Active dot: slightly larger (10px vs 7px).
- Centered horizontally, near the top of the shell.

**OnboardingScreenShell layout (top → bottom):**
1. `ProgressDots`
2. Title slot — `screenTitle` style (Lora 700, 27px)
3. Body/content slot — free slot for each screen's widget (sliders, chips, pickers)
4. Skip link — `label` style, `text-tertiary`, centered. "Skip for now"
5. Next / Continue button — full-width, `brand` bg, `text-inverse` label, `radius.card` (16), Outfit 600

**Styling:** Clean `bg` background throughout — no gradient header on onboarding screens. The gradient header is for the main app; onboarding should feel open and focused. Generous vertical spacing between sections.

---

## 6. Error, empty, and loading states

These are inline UI blocks (not separate screens) that appear in Home and Recommendations. They represent real conditions users encounter — design them to feel **calm and helpful, not alarming.** No red. Generous spacing. Each follows the same layout pattern:

```
[Icon — 48px, centered]
[Title — cardTitle style, centered, text-primary]
[Body — body style, text-secondary, centered, max-width ~260px]
[Optional action button — brand color]
```

### Loading states

**"Loading…" splash** (Home, RootNavigator initial load):
- Centered spinner (`ActivityIndicator` or equivalent, `brand` color) + wordmark/app name below.
- `bg` background.

**"Locating you…"** (Recommendations, while fetching GPS):
- Icon: `LocateFixed` (animating pulse if possible), `brand` color.
- Title: "Finding your location"
- Body: "Hang on just a moment."
- No button.

### Error walls (full-area blocks in Recommendations)

**"Location access denied":**
- Icon: `MapPinOff`, `text-tertiary`.
- Title: "Location access needed"
- Body: "Club 32 uses your location to sort rides by how far you are. You can enable it in Settings."
- Button: "Open Settings" (`brand` color), links to device settings.

**"Out of park":**
- Icon: `MapPin`, `text-tertiary`.
- Title: "You're outside the park"
- Body: "Recommendations are based on where you are in the park. Head in and we'll pick up from there."
- No button.

**"Park is closed":**
- Icon: `MoonStar`, `text-tertiary`.
- Title: "The park is closed right now"
- Body: "Check back when the park opens. Predictions will be ready for you."
- No button.

### Empty states

**"No wait time data available"** (Home):
- Icon: `Clock`, `text-tertiary`.
- Title: "No wait times yet"
- Body: "Data should appear once the park opens and rides start posting wait times."
- No button.

**"Couldn't get recommendations"** (Recommendations):
- Icon: `AlertCircle`, `text-tertiary` (not `skip` — this is a soft error, not a user-facing warning).
- Title: "Couldn't load recommendations"
- Body: "Something went wrong on our end. Try again."
- Button: "Try again" (`brand` color), triggers retry.

### Degraded banner (Recommendations top)

A **small, non-alarming** banner pinned to the top of the Recommendations content area when data is stale or best-effort. Should barely register — it's informational, not urgent.

- Background: `star-bg` (`rgba(245,158,11,0.12)`). No red.
- Icon: `Info` (14px, `star` color).
- Text: "Recommendations are best-effort right now" — `caption` style, `text-secondary`.
- No close button; dismisses automatically when data recovers.
- Full width, 10px vertical padding.

---

## 7. RideDetailModal → tall Sheet (do carefully)

The RideDetailModal is currently full-screen. Now that the `Sheet` primitive is stable, migrate it to a `tall` Sheet (≈90% snap point) so users can flick it down to dismiss instead of tapping a close button — which is more native and more in line with how every other overlay in the app behaves.

**Rules:**
- Preserve all existing content exactly: title, status row, trend SVG graph, p10–p90 range band, right-now-vs-typical tile, closure tile. Change only the container, not the content.
- Use `size="tall"` on the `Sheet` component. `dismissable={true}`.
- The `title` prop on Sheet carries the ride name. Remove the duplicate title rendering inside the modal content.
- Test on web (PWA) first — confirm the drag-to-dismiss and backdrop work as expected before calling it done.
- If anything about the SVG graph or range band breaks in the Sheet context (height constraints, scroll conflict), stop and flag it rather than hacking a fix.

---

## Acceptance criteria

- [ ] RideRow and RecCard built from `Card` base + Phase 1 tokens; no new inline styles.
- [ ] UpcomingWindowCard token-driven; content/logic untouched.
- [ ] NotificationRow uses Lucide status icons (no emoji).
- [ ] OnboardingScreenShell + ProgressDots match spec; all onboarding steps use the shell.
- [ ] All six loading/error/empty states implemented; none use red or alarming styling.
- [ ] Degraded banner is subtle (amber-tinted, not red).
- [ ] RideDetailModal migrated to tall Sheet; all content preserved; web tested.
- [ ] Zero new hardcoded color or style values anywhere in this phase.
