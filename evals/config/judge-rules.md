<!-- Rules the AI judges apply. Copied from "AI Recommendation Expectations" (2026-11-16),
     sections 2, 8 and 9. Keep in sync with the spec; the spec wins if they disagree. -->

INTENT
- Every recommendation is a present-tense action: something the guest can walk to right now. "Come back in an hour" is never a recommendation.
- Future forecasts are evidence, not actions. Any ride's forecast may be the reason one pick beats another ("skip that one for now, it drops hard by 2 PM, do this instead"). "Go to that ride in two hours" is a failure.
- On a bad day the top pick is framed honestly as the least bad move.

RANKING (priority order)
1. Present-tense only. A ride whose only merit is a later window is not a pick. Its later window may be cited on another pick's caption as the reason to do that one first.
2. Wanted rides. A wanted ride is assumed to have a plan, so a restriction is a caption flag, not a penalty. If its line is at or under usual, it leads. If its line is high and stays high, it can still lead with honest copy ("won't get shorter today"). If its line is high and drops within two hours, pick something else now and say when to come back on that pick's caption.
3. Party fit. For rides the guest does not want, a restriction is a strong penalty. A restricted ride is never presented as a clean fit.
4. Window strength. How far under usual, and how many minutes saved. Rare and falling beats merely short. A line long now but forecast to fall within 30 minutes is better than its number.
5. Distance, weighted by party. Walk is a real cost with a stroller, toddler, pregnant guest, wheelchair or tired kids; small for two adults. In a flat field, walk is the tiebreaker.
6. Headliners over volume when otherwise close.
7. Trust by cost of checking. A recently reopened ride's posted wait may lag. One minute away: it can still lead, with a warning. Eight minutes away: rank it below a steady option.
8. Skip verdicts may be picked only when the field is bad or the ride is wanted.
9. No penalty for outdoor or scenery rides after dark.
The verdict is evidence; the model may disagree and must say why.

CAPTIONS
- One sentence, about a dozen words. Lead with the single strongest reason this ride earned its spot now.
- Never the ride's own name. Another ride's name only when that comparison is the strongest argument. Rank 3 and below never name another ride or mention position.
- A number only when it does argumentative work with context ("half its usual line" beats "25 min").
- No ride descriptions unless they support the decision (party factor, condition, first-timer). A description tied to this party counts as a reason, not filler: "gentle" for a pregnant guest, "toddlers love it" for a toddler.
- No unsupported claims. Any rise, fall or hold claim must match the forecast. "Rarely this short" requires far below usual or a star verdict.
- No percentages, em dashes, exclamation marks, or app vocabulary: verdict, badge, score, window, must-do, list, and "star", "go" or "skip" used as the app's labels ("a star ride", "go verdict"). Plain English is fine: "Go now" and "skip it for now" are the intended voice.
- A skip-verdict pick opens with bad-day framing in its first clause ("Everything's busy today, and this is the least bad move"), never positive-timing words. A wanted skip ride says "you wanted this and it won't get shorter today" in that position.
- A restricted ride names who it affects. Height: mention rider swap where there are two adults. Pregnancy: one person sits this one out.
- A recently reopened ride is never "rare" or "a great deal", and if it leads, says the real line may be longer than posted.
- Voice: a friend who knows the park cold. Confident, warm, plain. "Go now", not "you might consider". No hype.
