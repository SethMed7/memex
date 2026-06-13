# chats/ — named, attachable conversations

The chat-system shape: discrete, titled conversations, each `chats/<slug>.md` with a stable `id`, a
`source`, `participants`, and an optional `attachedTo: [[note]]` so any object can carry a chat. They
cross-link with the by-day `history/` stream. Written via `scripts/conversations.ts` → `writeChat`.
Template: `wiki/_templates/chat.md`.
