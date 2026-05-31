# Club 32 — Core User Moments

These are the four situations a user is in when they reach for Club 32. Every feature should serve at least one of them. If it doesn't, don't build it.

---

## Moment 1 — "What should I do next?"

**Situation:** The user just got off a ride, finished a meal, or has a free moment. They have no destination in mind.

**What they want:** Tell me the single best move right now. Don't make me think.

**What Club 32 does:** Recommends the best next ride based on where wait times are *heading* — not where they are right now. The recommendation accounts for walk time, their preferences, and predicted conditions by the time they arrive.

**What failure looks like:** Showing a list of current wait times and making the user decide.

---

## Moment 2 — "I'm thinking about going to X — should I, or should I wait?"

**Situation:** The user has a destination in mind but isn't sure if the timing is right.

**What they want:** Validate or redirect my plan before I commit to walking there.

**What Club 32 does:** Confirms the move or tells them to wait — and if wait, tells them approximately when the window will be better. Always forward-looking. Never "the current wait is 45 minutes."

**What failure looks like:** Confirming a bad move because the current wait happens to look acceptable.

---

## Moment 3 — "I'm in line. Should I stay or bail?"

**Situation:** The user is already in a queue. The line feels long or stopped. They're second-guessing themselves.

**What they want:** An honest answer — is this still worth it, or is there a better move?

**What Club 32 does:** Weighs their remaining estimated wait against where that ride and nearby alternatives are predicted to go. Gives a clear recommendation: stay, or here's what to do instead.

**What failure looks like:** Just showing the current posted wait with no forward context.

---

## Moment 4 — "Something good is happening at a ride right now."

**Situation:** A ride just hit a predicted trough — post-breakdown reopen, crowd thinned, optimal window arrived. The user doesn't know this yet.

**What they want:** They don't know they want anything yet. This is a proactive alert.

**What Club 32 does:** Surfaces the opportunity before the crowd catches on. Language is always probabilistic — "X is trending toward a good window" not "go now."

**What failure looks like:** Alerting too late (after the crowd has already responded) or framing it as a current-state fact instead of a forward-looking signal.

---

## North Star Reminder

The app's value is **predictive, not reactive.** Current wait times are a commodity — Disney's own app shows them. Club 32's job is to tell the user what the park will look like *when they get there*, and what to do next.
