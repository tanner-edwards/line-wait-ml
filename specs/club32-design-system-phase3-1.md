# Club 32 — Design System · Phase 3.1: RideRow Refinements

## For Claude Code

Targeted revisions to Phase 3 based on Live Waits and RideDetail sheet review. Three things:
1. RideRow changes to rows (not cards) + simplified status treatment
2. Walk On badge spec + badge precedence rule
3. RideDetail sheet layout fixes

Nothing else in Phase 3 changes. RecCard, onboarding shell, states, and RideDetailModal migration are unaffected.

---

## 1. RideRow — rows, not cards

The Phase 3 spec said to use the `Card` base for RideRow. **Revise that.** Home/Live Waits is a 30+ item directory, not a curated shortlist. Card-per-row creates visual noise and makes the list feel impossibly long.

**Use compact rows with dividers instead:**
- No rounded border per row
- No card background wash or shadow per row
- A subtle full-width divider (`border` token) between rows
- Tight vertical padding (~12px top/bottom)
- The `Card` base is reserved for RecCard (Recommendations) only

Row layout:
```
[Badge]  Ride Name (cardTitle)          [Wait / Walk On label] [ChevronRight]
         ~X min walk (caption, text-tertiary)    [Trend label + TrendArrow]
```

Status color in the list lives in the **wait number only** — `go` if below normal, `skip` if above, `text-primary` otherwise. No left border accent, no background wash. Those treatments stay on Recommendations cards only.

---

## 2. Walk On badge

### Visual treatment
- Replace the wait number entirely with: `Footprints` icon (Lucide, 14px) + "Walk On" label
- Color: `text-primary` — **no color accent**
- No green, no indigo, no special highlight
- It's factual information, not a recommendation

Walk On is neutral by design. Coloring it would imply it's always desirable, which isn't true — many rides are permanent walk-ons and surfacing them as opportunities would mislead users.

### Badge precedence — IMPORTANT

Badges are mutually exclusive. Walk On is the **lowest tier** and is suppressed if any stronger signal applies:

| Priority | Badge | Shows when |
|---|---|---|
| 1 | ⭐ Star | Rare opportunity (algorithm-determined) |
| 2 | ↓ GO (green) | Below historical normal |
| 3 | ↑ SKIP (red) | Above historical normal |
| 4 | 👣 Walk On | At walk-on threshold AND no other badge applies |
| — | (none) | Everything else |

A ride cannot show Walk On AND a GO/SKIP/STAR badge. If a higher-tier badge applies, Walk On is suppressed entirely.

### Follow-up task for recommendation engine (not Phase 3 UI — flag for later)

Walk On detection may produce false positives on rides where a walk-on is actually rare and valuable (e.g. Guardians of the Galaxy). When Guardians hits walk-on territory, that's a gold-star moment — not a neutral Walk On. The badge precedence rule above handles the display correctly, but the underlying scoring logic should be reviewed to ensure rides like Guardians get surfaced as STAR rather than Walk On when appropriate. Flag for a dedicated scoring review session.

---

---

## 3. RideDetail sheet layout

The detail sheet header should feel like a natural expansion of the list row — same layout, just more information. Right now the header is a different arrangement, which creates a subtle disorientation when the sheet slides up.

### Alignment fix

The header content and the content tiles below (RIGHT NOW VS TYPICAL, TREND, etc.) are at different horizontal insets — the tiles appear narrower than the header. The cause is double-padding: the outer container has padding AND the tiles have their own outer margin on top of it.

Fix: one consistent `16px` horizontal padding on the outer sheet container. Card tiles get no additional outer margin — they share the same edge as the header content.

### Header layout — match the list row

The list row pattern is: **details on the left, wait number on the right.** The detail sheet header should follow the same pattern so tapping a row feels like expanding it, not switching to a different layout.

```
Indiana Jones™ Adventure                [X]
Adventureland · Disneyland         35 min  (waitNumber style, right-aligned)
[Bell]  [Below typical badge]      ↓ Dropping  (trend, right-aligned)
[~10 min walk pill]
```

Specific changes:
- **Wait number** (`waitNumber` style — Outfit 700, 24px, tabular-nums): right-aligned, same row as location
- **Trend indicator** (TrendArrow + label): right-aligned, below the wait number
- **Badge** (Below typical / Above typical): left-aligned, below location
- **Bell icon**: left-aligned, inline with badge
- **Walk pill**: left-aligned, bottom of header block
- Title and X button: unchanged, full-width top row

---

## Acceptance criteria

- [ ] Home/Live Waits uses rows with dividers, not individual cards
- [ ] Status color appears only in the wait number, not in card borders or backgrounds
- [ ] Walk On shows as plain black Footprints + "Walk On" — no color accent
- [ ] Walk On never appears alongside GO, SKIP, or STAR — higher tier always wins
- [ ] RecCard (Recommendations) is unchanged — cards still appropriate there
- [ ] RideDetail sheet header and content tiles share the same horizontal edge (16px container padding, no tile outer margin)
- [ ] RideDetail sheet header layout matches the list row — wait number right, details left
