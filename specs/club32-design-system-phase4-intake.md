# Club 32 — Design System · Phase 3.3: Intake Flow Polish

## For Claude Code

Polish pass on the onboarding/intake screens. The goal is a fast, frictionless questionnaire that doesn't feel like a barrier to entry. Users should be able to get through it quickly by just tapping, with no pressure to fill out every detail.

---

## Core behavior model

There are two screen types in the intake flow. Each has different interaction behavior.

**Single-select screens** (TripDuration):
- Tapping an option immediately advances to the next screen — no Continue button
- Selection triggers a brief visual confirmation (~150ms brand border highlight) then auto-advances
- The only fallback is a small "Skip this question" text link for users who genuinely don't want to answer

**Multi-select screens** (RidePreferences, AccessibilityNeeds):
- Tapping an option toggles it selected/unselected
- A single "Continue" button at the bottom — always visible, always enabled
- If the user taps Continue with nothing selected, it advances anyway — same behavior as skipping
- No separate Skip button; Continue covers both cases cleanly

**MustDoRides** — structure is correct, minor fixes only (see below).

**DailyParkSheet** — follows the same single-select rules since it's a one-question screen.

---

## 1. Kill the big Skip button

The current full-width blue "Skip" button is the most visually dominant element on most screens — more prominent than making a selection. This is backwards.

Replace it with a small text link on every screen:

- Style: `label` text style, `text-tertiary`, centered
- Label: "Skip this question"
- Position: below the options, above the bottom safe area — not pinned to the very bottom edge
- On multi-select screens, remove Skip entirely — the Continue button already handles advancing with no selections

---

## 2. Selected state — consistent across all screens

Every selectable option (single or multi-select) uses the same selected treatment:

**Unselected:** white card, `border` token, `text-primary` label
**Selected:** `brand` border (2px), `brand` colored label text, `CircleCheck` icon (Lucide, `brand` color, right-aligned)

This is already correct on the MustDoRides screen — apply the same pattern to TripDuration and RidePreferences.

---

## 3. Ride Preferences — remove emoji, go icon-free

The category cards (Thrills, Classics, Immersive, Kid Favorites, Shows & Characters, etc.) currently use emoji as icons. Remove them entirely — do not replace with Lucide icons.

The category name + example rides underneath is fully self-explanatory. Strong typography carries it without an icon:

```
Thrills
Space Mountain, Big Thunder, Matterhorn, Guardians
```

No icon. No emoji. The name and examples are the whole story.

---

## 4. MustDoRides — search icon fix

Replace the 🔍 emoji in the search field with the Lucide `Search` icon. Everything else on this screen is correct — don't change the YOUR PICKS / MORE TO ADD section structure or the selected state (it's already right).

---

## 5. Reassurance text

Add a single small line near the Skip link on each screen:

> "You can update this anytime in your Profile."

Style: `caption`, `text-tertiary`, centered. This removes the "I'm locked in" anxiety without cluttering the screen.

---

## 6. Continue button (multi-select screens only)

- Full-width, `brand` bg, `text-inverse` label, `radius.card` (16px)
- Label: "Continue" — always, regardless of whether anything is selected
- Always enabled — no disabled/grayed state
- Pinned to bottom above safe area

---

## Acceptance criteria

- [ ] Tapping any option on TripDuration immediately advances — no Continue button present
- [ ] Brief selected state flash (~150ms) before auto-advance on single-select screens
- [ ] Multi-select screens have a single "Continue" button — always enabled, no separate Skip button
- [ ] "Skip this question" text link present on single-select screens, removed on multi-select
- [ ] Selected state is consistent: brand border + brand text + CircleCheck icon
- [ ] No emoji anywhere in the intake flow — category screen is icon-free
- [ ] MustDoRides search field uses Lucide Search icon
- [ ] "You can update this anytime in your Profile" reassurance text on every screen
- [ ] DailyParkSheet follows the same single-select behavior rules
