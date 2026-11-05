---
"ovr": patch
---

Fixes from a fifth review:

- **Migrations:** a migration runs through PL/pgSQL's `EXECUTE`, so a `BEGIN`, `COMMIT`, or `ROLLBACK` in it is an error that names the migration, instead of committing part of it early and leaving those changes applied but unrecorded when a later statement fails.
- **Rate limits:** buckets are stored under a SHA-256 hash of their name, policy, scope, and identity, so a long multi-byte key or an agent's long host always fits in the primary key's index instead of failing the request.
- **MCP:** a route parameter named `:wildcard` is filled by its own argument, not taken for the `*` wildcard. A parameter with a lone surrogate returns a tool error instead of throwing.
- **Multipart:** only a delimiter starting the body or a line opens the first part, so one mentioned within the preamble cannot add fields.
- **Schemas and forms:** a form field, `pick`, `omit`, or JSON Schema property named `__proto__` is set as an own property instead of changing the object's prototype. Unions and arrays with very many issues no longer overflow the stack.
