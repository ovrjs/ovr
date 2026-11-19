---
"ovr": patch
---

`app.fetch` takes the client's IP from a server passed as its second argument, as Bun's is, so `Bun.serve(app)` sets `c.ip`.
