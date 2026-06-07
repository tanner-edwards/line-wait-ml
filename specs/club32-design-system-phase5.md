# Club 32 — Design System · Phase 3.4: Profile Screen Polish

## For Claude Code

Full polish pass on the Profile screen. The main structural change is card-grouped sections — same pattern as iOS Settings. Everything else is cleanup that falls out of that decision.

---

## 1. Layout structure

Replace the current undifferentiated flat list with three card-grouped sections. The screen background is `bg` token. Each section has a `SectionHeader` above it and a single `Card` containing all its rows, with `border` token dividers between rows inside the card.

```
GradientHeader ("Profile")
─── scroll area ────────────────────────────
SectionHeader: "Your Visit"
Card:
  TapEditRow: Trip length
  ──────────────────────────
  TapEditRow: Youngest in group
  ──────────────────────────
  TapEditRow: Ride preferences
  ──────────────────────────
  TapEditRow: Must-do rides
  ──────────────────────────
  TapEditRow: Accessibility
  ──────────────────────────
  TapEditRow: Today's parks    ← opens DailyParkSheet, not PersonaFieldModal

SectionHeader: "Notifications"
Card:
  ToggleRow: Enable notifications
  ──────────────────────────
  TapEditRow: Notification types    ← conditional, see §3

SectionHeader: "Debug"    ← dev-only section, see §4
Card (muted):
  ToggleRow: Debug mode
  ──────────────────────────
  TapEditRow: View logs    ← conditional

  Reset button    ← inside the debug card, see §4
```

---

## 2. Row components — consolidate to one implementation

Currently persona rows use `TapEditRow` and notification/debug rows use hand-rolled Pressables. Consolidate everything to the same component with two variants:

**`TapEditRow`** (existing) — label above, value below, `ChevronRight` on right. Used for all persona rows, Notification types, View logs.

**`ToggleRow`** (new, extends TapEditRow layout) — same label + value layout, but a native `Switch` on the right instead of `ChevronRight`. No tap-to-navigate. Used for Enable notifications and Debug mode.

Both variants: 20px horizontal padding, 16px vertical padding, `border` token divider between rows (not full-width — inset 20px from left to align with text). Rows share the outer card's surface background — no individual row background.

---

## 3. Conditional rows — animate in/out

"Notification types" (only when notifications on) and "View logs" (only when debug on) currently blink in/out causing layout shift. Add `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` before any state change that shows/hides these rows. One line fix.

---

## 4. Debug section — visually muted

The debug section should look intentionally non-production. It exists for dev use and shouldn't look like a standard user-facing section.

- `SectionHeader` label: "Debug" in `text-tertiary` (not the standard section header color)
- Card: same `Card` base but with `border-strong` border instead of `border` — slightly more visible edge signals "this is different"
- Debug mode value text when on: use `text-tertiary` — **remove the unique orange (`#f5a623`)**. Orange is the only place it appears in the whole app and it's disconnected from the palette.
- **Reset button:** inside the debug card as the last row. NOT a full-width button. Style it as a muted destructive row: left-aligned text "Reset persona" in `skip` color, no chevron, 16px vertical padding — looks like a row, not a prominent CTA. No border, no background fill.

---

## 5. Must-do rides — truncate value

Long must-do lists produce ragged variable-height rows. Truncate the display value to the first two picks + a count:

> "Space Mountain, Matterhorn +4 more"

If 1 pick: show the name. If 0: "None picked". Cap at one line — `numberOfLines={1}` on the value text.

---

## 6. Tokenize remaining hardcoded colors

CC flagged these with `// TODO: tokenize` comments. Replace them all in this pass:

| Hardcoded | Token |
|---|---|
| `#eee` (dividers) | `border` |
| `#f4f4ff` (press state) | `bg` at low opacity or `border` |
| `#f5a623` (debug orange) | `text-tertiary` |
| `#fff` | `surface` |
| `#999`, `#bbb` | `text-tertiary` |
| `#222` | `text-primary` |

---

## 7. Notification settings modal — two fixes

**Peak alert icon:** Currently uses `OctagonX` in gold — same shape as the closure icon, only color differs. Replace with `TrendingUp` in `star` color. Closure = `OctagonX`, Peak = `TrendingUp`. Clear visual distinction.

**Stale footer copy:** The footer reads "Notifications still respect 'I'm at the park today' and the daily park scope." — that UI element no longer exists. Replace with: "Notifications only send while you're at the park."

---

## 8. GradientHeader subtitle

Currently reads "Tap any row to edit." — reads like a UI instruction, not a subtitle. Remove it. The chevrons on every row already communicate tappability. The header just shows "Profile."

---

## Acceptance criteria

- [ ] Screen has three card-grouped sections: Your Visit, Notifications, Debug
- [ ] All rows inside a section share one Card — no individual row cards
- [ ] TapEditRow and ToggleRow used consistently — no hand-rolled Pressable rows remaining
- [ ] Conditional rows (Notification types, View logs) animate in/out with LayoutAnimation
- [ ] Must-do rides value truncated to "X, Y +N more" — one line always
- [ ] Debug section visually muted: text-tertiary label, no orange, reset is a muted row not a button
- [ ] All // TODO: tokenize colors replaced with tokens
- [ ] Peak alert icon changed to TrendingUp
- [ ] Footer copy in NotificationSettingsModal updated
- [ ] GradientHeader subtitle removed
