---
"ovr": minor
---

`auth.agents(c)` lists the agents the signed-in user has connected, each with its `id`, the `name` it gave when it was approved, when it was `connected`, and when the connection `expires`. It replaces querying `auth_tokens` yourself. `auth_tokens` has a `name` column for it, in the `auth:1` migration.
