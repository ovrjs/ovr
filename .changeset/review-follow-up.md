---
"ovr": patch
---

A page's forms have IDs of their own, a forwarded write is followed, and the render-ahead limit is removed.

- Two forms on a page with a field of one name both rendered `id="title"`, so a label could name the wrong input. The first form keeps the field's name as its ID, and each after it is numbered: `f2-title`, with its issue and description to match.
- An agent's write that a route sends on with a 307 or 308 is followed within the app, with its method and body. It was reported as done, though the route that does it was never called.
- The MCP endpoint answers a request from another origin with 403 on GET and DELETE too, where it answered 405.
- The limit on how far a child renders before its turn, added in the last release, is removed: children render and queue as far as they can, as before.
