---
"ovr": patch
---

`Tester` finds the app's `Auth` itself, as it does the MCP endpoint, so it no longer takes `auth`: `new Tester({ app, user: "user-1" })`.
