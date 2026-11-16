---
"ovr": minor
---

- The MCP endpoint no longer serves resources: `resources/list`, `resources/templates/list`, and `resources/read` are gone, with the `page://` names. An agent reads a page with its GET route's tool, as every client we connected already did. A file in a tool's result is named by its address.
- A tool whose route answers with JSON, such as `c.json()`, gives the value as `structuredContent` beside the text, when it is an object.
- `auth.consent(c)` returns the host the user goes back to as `returns`, where it was `redirect`, since it is a host and not an address.
