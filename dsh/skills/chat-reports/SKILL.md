---
name: chat-reports
description: Produce structured analysis reports over whole WhatsApp conversations by fanning out one subagent per chat, each exporting its own transcript with wa_export_conversation and writing a bounded report, then merging the results. Use when the user asks to "analyze my conversations", "summarize the last N days per chat", "give me a report on who's been talking about X", or wants per-chat digests across many chats.
---

# WhatsApp Chat Reports

Generate per-chat analysis reports at scale without blowing up a single
context. The pattern is: **the parent picks and delegates, each subagent
fetches its own data and writes its own report, the parent merges.**

## When to use

- "Summarize my last 7 days of WhatsApp."
- "For each of my top 20 chats, write a one-paragraph digest."
- "Report on every conversation where <topic> came up in the last month."
- "Give me a weekly review of my group chats."

## Preconditions

- The `@rafa/dsh-whatsapp-agent` plugin is loaded, so the `wa_*` tools are
  available (notably `wa_analytics`, `wa_list_chats`, `wa_export_conversation`).
- You are an agent with access to subagent-spawning tools (`subagent`,
  `subagent_fork`, or the `workflow` script runner).

## Procedure

### 1. Select chats

Use `wa_analytics` to get the top chats by volume, or `wa_list_chats` to browse
by recency. Resolve the concrete JID list first — subagents need exact JIDs, not
names. If the user named specific chats, `wa_resolve_chat` each one.

Decide the window: `wa_analytics(days=N)` matches "last N days". If the user
says "entire conversation", omit `days` in the export and rely on
`max_messages` as the safety cap.

### 2. Fan out — one subagent per chat

For each chat, spawn a **subagent** (prefer `subagent_fork` when the subagent
should inherit the already-known chat list/JIDs; plain `subagent` otherwise).
Give each subagent a self-contained brief:

- the exact chat JID and the window (`days`),
- an instruction to call `wa_export_conversation` itself with
  `chats: [jid], days, preset: 'llm', format: 'md'`,
- a fixed report schema to return (see below).

Do **not** export the transcript in the parent and inline it into the subagent
prompt — that re-bloats context. The subagent owns its fetch.

### 3. Collect and merge

Each subagent returns a bounded structured result. Merge them into one summary
document: an overview table (chat, message count, key themes, action items)
followed by the per-chat reports.

## Report schema (hand this to each subagent)

Return JSON with these keys:

```json
{
  "chat_jid": "...",
  "chat_name": "...",
  "window": { "days": 7 },
  "message_count": 123,
  "sentiment": "positive | neutral | negative | mixed",
  "key_themes": ["..."],
  "people_of_note": ["..."],
  "decisions_or_commitments": ["..."],
  "open_questions": ["..."],
  "summary": "2-3 sentence digest",
  "action_items": ["..."]
}
```

Cap `summary` to a few sentences and each list to at most 5 items so the merged
report stays readable.

## Bounds & safety

- Cap `max_messages` per export (e.g. 5000) — a single chat's full history can
  be huge; `wa_export_conversation` truncates oldest-first.
- Use `preset: 'llm'` for analysis (tight but complete); `preset: 'archive'`
  only when the user wants an archival dump, not a digest.
- Fan out in parallel where the runtime allows; if there are dozens of chats,
  batch them (e.g. 8–10 at a time) to bound concurrency.
- Read-only skill: never send messages, never mutate memory, unless the user
  explicitly asks for a follow-up action based on the report.

## Example brief for a subagent

> Analyze WhatsApp chat `5511999999999@s.whatsapp.net` for the last 7 days.
> Call `wa_export_conversation` with `chats: ["5511999999999@s.whatsapp.net"]`,
> `days: 7`, `preset: "llm"`, `format: "md"`. Read the transcript and return a
> JSON report using this schema: … (schema above). Keep the summary to 3
> sentences and each list to ≤5 items.
