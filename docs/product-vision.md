# Club 32 — Product Vision

## What it is

Club 32 is an AI-powered Disney park companion that tells you what to do *next*, not what's happening *now*. The name is a nod to Disneyland's invite-only Club 33 — "for the rest of us."

**North star:** remove the "PhD in Disney" barrier to park planning. The target user is the casual or first-time visitor, not the Disney enthusiast (TouringPlans.com already serves them). The value prop is AI reasoning over wait-time data — a recommendation engine that tells the user exactly what to do next, grounded in where lines are *heading*, not where they are right now.

**Current wait times are a commodity.** Disney's own app shows them. Club 32's job is to tell the user what the park will look like *when they get there*, and what to do next.

## What it is NOT

- Not a dashboard or a raw data view
- Not a tool for Disney experts or power planners
- Not a trip planning service (trip plan = output of onboarding, not a separate feature)
- Not a scheduler ("here's your minute-by-minute itinerary")

## The four user moments

Every feature should serve at least one of these. If it doesn't, don't build it. Full detail in `docs/user-moments.md`.

| # | Moment | Failure mode |
|---|--------|-------------|
| 1 | "What should I do next?" — just got off a ride, wants the single best move | Showing a list of current waits and making the user decide |
| 2 | "I'm thinking about going to X — should I, or should I wait?" | Confirming a bad move because the current wait looks acceptable |
| 3 | "I'm in line. Should I stay or bail?" | Showing the posted wait with no forward context |
| 4 | "Something good is happening at a ride right now." — a trough the user doesn't know about yet | Alerting too late, or framing it as current-state fact |

## Predictive, not reactive

The scoring and recommendation system is built around *peak/trough detection per ride*, not raw wait-time prediction. The AI layer makes calls like "go now," "avoid this land," "come back in an hour." The ML model emits forecasts; downstream layers convert them into recommendations.

Language is explicitly probabilistic: "X is trending toward a good window" not "go now."
