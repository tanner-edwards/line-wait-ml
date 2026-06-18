# Club 32 — Token Spam Prevention

## Problem statement

The `POST /v2/recommendations` Lambda endpoint invokes AWS Bedrock (Claude Haiku) once per request, at roughly **1¢ per call**. Today there are no per-key or per-IP usage limits in place:

- API Gateway requires an `x-api-key` header but its `UsagePlan` is empty — no rate limit, no burst limit, no daily quota.
- The single API key is bundled in the Expo app binary as `EXPO_PUBLIC_API_KEY`. Anyone who decompiles the app can extract it and hit the endpoint directly.
- The frontend fires a fresh request on every persona-field toggle (no debounce) and on every "Show more" tap (no cooldown).
- The in-Lambda response cache keys on GPS coords rounded to ~11 m, so normal location jitter while standing still bypasses it.

Result: a single accidental loop on the developer's device, an aggressive test session, or one leaked key could quietly run the Bedrock bill into hundreds of dollars before the existing $10/month CloudWatch alarm fires.

## Goal

Cap worst-case daily Bedrock spend at approximately **$3/day** through a layered defense, without rewriting auth or adding heavy infrastructure. The system should remain usable for the developer and a handful of testers under normal usage.

## Non-goals

- Replacing the shared API-key model with per-device auth (Cognito, JWT). Right answer eventually, wrong answer at <10 users.
- Adding AWS WAF.
- Building a programmatic dollar-based circuit breaker. Deferred until pre-public launch.
- Adding an on-device response cache in the app. The backend cache improvement covers most of the same ground.

## Requirements

### Must-have

1. **Hard daily call ceiling on the recommendations endpoint.** API Gateway enforces a daily quota of ~300 calls before any request reaches Lambda. Once exhausted, further calls return 429 from the edge.
2. **Throttle on burst traffic.** Steady-state rate ~1 req/sec, burst ~5. Prevents 100-requests-in-a-second loops from emptying the quota in a few seconds.
3. **Separate quotas for cheap vs expensive endpoints.** `GET /v0/waits/*` (Firestore-only, ~free) uses one API key with a generous plan and no daily quota. `POST /v2/recommendations` (Bedrock-hitting) uses a second key with the strict quota.
4. **Frontend collapses incidental spam before it leaves the device.** Persona-field toggles debounce so rapid edits fire one call, not N. "Show more" disables for ~10 seconds after each tap.
5. **Cache hits are not defeated by GPS jitter.** The recs cache keys on the *derived* current ride (the nearest-ride lookup), not on raw lat/lng. Walk distances remain user-specific.
6. **Per-IP throttle inside Lambda as a second line of defense.** A single source IP exceeding ~20 calls/minute receives 429. Stops a leaked-key attack from hitting the daily quota in seconds.

### Nice-to-have

- Visible cooldown feedback on the "Show more" button (countdown or disabled appearance), not just a no-op tap.
- 429 responses include a short reason string the frontend can show ("Try again in a moment.") instead of a generic failure.

## User-facing behavior

**Normal use, developer + testers:**
- App opens → recommendations load as today, no perceptible change.
- Toggling persona fields rapidly → only one network call fires after edits settle (~500–800 ms after last edit).
- Tapping "Show more" → fires immediately, then visibly waits ~10 s before allowing another tap.

**Abuse / loop / leaked key:**
- After ~5 fast requests, API Gateway returns 429 (burst exhausted).
- After ~300 requests in a day, API Gateway returns 429 for the rest of the calendar day (UTC).
- After ~20 requests from a single IP within a minute, Lambda returns 429 (IP throttle), regardless of API key state.

**Cache behavior:**
- Two users (or the same user with slight GPS drift) standing at the same ride see identical LLM recommendations from a cached response, but each sees walking distances computed against their own coordinates.
- Time-travel `?at=` requests continue to bypass the cache.

## Edge cases & constraints

- **Per-warm-container IP throttle state:** the in-Lambda IP bucket lives in module memory. With <10 users one container handles essentially everything, so the effective limit holds. If concurrency grows, multiple warm containers each enforce their own bucket — a soft cap, not a hard one. Acceptable for current scale.
- **Daily quota is calendar-day UTC, not local.** A quota reset at 17:00 PDT is the expected behavior.
- **The developer can lock themselves out.** Hitting the quota with their own testing means they wait until UTC midnight or temporarily raise the quota and redeploy. Acceptable trade-off.
- **The frontend bundle ships both API keys.** This is not a security improvement against extraction — it's about clean separation of concerns and confining the strict quota to the Bedrock-hitting endpoint.
- **Time-travel debug requests should still bypass cache** but should still count against the quota. (They are still real Bedrock calls.)
- **Persona-toggle debounce must not delay first paint.** The first persona load on mount fires immediately; the debounce applies only to subsequent rapid edits.
- **Cache key migration:** the move from lat/lng-based key to `currentRideId`-based key invalidates existing cache entries on deploy, which is fine (cache lives in Lambda memory and resets on cold start anyway).

## Open questions

None. All design decisions captured above are agreed.

## Deferred (future work)

- **Tier 3 — Programmatic dollar circuit breaker.** A scheduled cost-checker Lambda writes a flag to SSM/Firestore when today's Bedrock spend exceeds $X; the recs handler short-circuits to deterministic fallback when set. Reconsider before any wider release.
- **Per-device auth.** Replace shared API key with a Cognito identity pool or device-bound JWT minted from an unauthenticated `/v0/register` endpoint. Lets us revoke individual abusers and run per-device quotas. Revisit at ~100 users or first real abuse incident.
- **AWS Budget auto-disable.** Wire `AWS::Budgets::Budget` with an SNS-triggered Lambda that disables the recs API key when monthly spend exceeds threshold. Lower priority than the Tier 3 circuit breaker because Budgets has 6–24 h reporting lag.
- **On-device response cache** with a TTL matching the server's, so back-button round-trips never touch the network.
