# Club 32 — Roadmap

Status key: ✅ Shipped · 🔄 In progress · 📋 Planned

---

## ✅ v0 — Walking skeleton

Expo PWA + Lambda + API Gateway + API key auth. Lambda calls Themeparks.wiki, returns live wait times, app displays them. Home screen with ride list grouped by land. Browse tab.

## ✅ v1 — Historical context + scoring

- GCP Cloud Run Job computes weekly averages per `(rideId, bucket, dayType)` from the raw Firestore data and writes them to `historical_averages`.
- Lambda returns historical averages alongside live waits, plus 5-bucket future curve (t+0 through t+120 min).
- Deterministic scoring layer: `go` (below normal), `skip` (above normal), `star` (all-time dip) badges.
- Trend direction (Dropping / Rising / Steady) derived from a combined past-delta + future-curve signal.
- Today's Range bar on ride detail — p10/p90 range with current position and typical wait marker.
- Trend sparkline on ride detail.

## ✅ v2 — AI recommendations

- Recommendations screen (default tab on launch).
- Lambda calls AWS Bedrock (Claude Sonnet) with full park context (rides, scores, projections, walk distances) and returns 10 ordered ride suggestions with one-liner rationale per ride.
- Manual location picker (park + current ride) as GPS proxy. Persists across sessions; re-prompts if > 1 hour stale.
- Walk-time computation: haversine × path multiplier, shown on each card.
- LLM prompt is entirely server-side; client sends only `{ park, currentRideId }`.

## ✅ v3 — Personalization

- Profile tab: persona intake (visit length, youngest age, ride preferences, must-do rides, accessibility needs).
- All questions skippable; zero answers → "average family" persona.
- Persona stored device-locally (AsyncStorage); no backend user accounts.
- Persona threaded into Lambda recommendations call — LLM uses it to filter and rank.
- Watchlist (mustDoRideIds) drives notification eligibility.

## ✅ v4 — Location awareness

- GPS replaces the manual ride picker in production.
- App detects which park the user is in from coordinates; nearest ride used as LLM anchor.
- Out-of-park detection with a simple center + radius boundary per park.
- Debug mode: restores the manual picker (ride-filtered to operating rides only); chosen ride's lat/lng used as fake GPS position. Everything downstream is identical.
- Walk distances computed from actual GPS position.

## ✅ v5 — Notifications

- Three types: trough alert (ride hits a notable low), closure alert (ride goes DOWN), reopen alert (ride comes back).
- All opt-in, gated by a per-day "I'm at the park today" arm toggle.
- Cooldown: 30 min per `(deviceId, rideId, type)`.
- PWA delivery via Web Push (VAPID). At native transition, replace with Expo Notifications (APNs/FCM).
- Notification history sheet in-app (stale-while-revalidate from Firestore + AsyncStorage cache).
- Notification deep-link routing: OS tap opens the app to the correct ride detail sheet.
- Notification copy in shared `notification-copy.js` (used by scanner and history view to stay in sync).

---

## 📋 v6 — Lightning Lane integration

User logs which Lightning Lane / Individual Lightning Lane windows they've booked. AI doesn't recommend rides already covered by LL; optimizes activity in gaps between LL windows.

---

## 📋 vAnytime — ML replaces averages

The data pipeline has been collecting raw snapshots since May 2026. When enough data exists, a trained tree-based model (LightGBM) replaces the weekly averages with per-ride predictions.

**The swap is backend-only.** The Lambda response shape already includes `prediction: null` as a placeholder. ML predictions write to the same Firestore schema the averages use, keyed identically. The app and API contract don't change.

Target: **peak/trough detection per ride**, not raw wait-time prediction. The model emits the signal; the scoring + LLM layers convert it into plain-language recommendations. See `docs/disney-data-quirks.md` for training-time feature engineering requirements.

---

## Deferred features (not forgotten, just not yet)

| Feature | Blocked on |
|---|---|
| Location-triggered notifications ("you're near a dropping ride") | Background GPS — requires native app |
| Per-ride downtime estimate in closure alerts | Per-ride downtime classifier (ML) |
| Sunset/weather as demand signals | More data + model training |
| Multi-horizon model agreement (ensemble confidence) | ML model first |
| Lightning Lane optimization | v6 |
| User accounts / cloud persona sync | Explicit decision to go native + add accounts backend |

---

## What's in flight / pending

- `pending-changes.md` (in `~/.claude/specs/line-wait-ml/`) tracks in-flight UI items.
- Current focus: ride detail sheet polish, recommendation UX, design system consistency.
