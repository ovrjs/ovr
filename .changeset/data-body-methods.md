---
"ovr": patch
---

`c.data()` reads a route's fields from the request body for every method except GET and HEAD, which read the URL. PUT, PATCH, and DELETE routes with fields read the URL before, so MCP tool calls to them always failed validation.
