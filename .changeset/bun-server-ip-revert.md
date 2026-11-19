---
"ovr": patch
---

`app.fetch` no longer takes the IP from a server passed as its second argument. On Bun, pass it as on any server: `app.fetch(request, { ip: server.requestIP(request)?.address })`.
