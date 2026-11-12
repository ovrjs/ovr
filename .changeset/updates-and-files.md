---
"ovr": minor
---

- `result.updates` from `c.data()` is what a request sets, to update a record with: each field it sent, `null` for one sent empty, and nothing for one it left out, which keeps its value. A form sends every field it has, and an agent's tool call only the arguments it gives, so an agent that leaves a field out no longer clears it. `database.sql.set(table, result.updates)` writes it.
- A page a route sends with `Content-Disposition: attachment` is HTML for an agent too, and its tool result is the file, an embedded resource, where before it was read as Markdown. Use it for a page an agent passes on, such as one to print.
