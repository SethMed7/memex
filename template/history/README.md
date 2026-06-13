# history/ — by-day conversation stream

One note per day at `history/<YYYY>/<YYYY-MM-DD>.md` — the message-platform shape (a continuous stream
bucketed by day). The memex owns the surface + template; the *owning tool* distills its own
conversations into it via the conversation contract (`scripts/conversations.ts` → `appendDaily`).
Distillations, not transcripts. Template: `wiki/_templates/daily.md`.
