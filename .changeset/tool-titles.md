---
"ovr": minor
---

- An MCP tool has a `title`, the first sentence of its route's description.
- A tool says `destructiveHint`: `true` for one that writes and `false` for one that reads. Clients already assumed a write may be destructive, so they behave as before, and directories that require the hint now get it.
- `describe(description, { destructive: false })` marks a route that only adds, such as one that creates a record, and never changes or deletes what is there. Its tool says `destructiveHint: false`, so a client need not confirm it. `route.tool.destructive` reads it.
