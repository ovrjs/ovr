---
"ovr": patch
---

The MCP endpoint follows the 2026-07-28 specification more closely: a missing resource is an invalid params error (-32602) that names its URI, where it was -32002; `resources/read` results carry the required `ttlMs` and `cacheScope`, private when agents sign in; and `ping`, which that version removed, is not found. The earlier versions keep their own behaviour.

With `auth`, a page's resource name is `page://host/path` where it was its `https` address, since the specification keeps `https` names for what an agent can fetch itself, and these pages need the user's session. `resources/read` takes either form, and links inside a page stay real addresses. Apps without `auth` keep `https` names.

The endpoint is now tested with the official MCP conformance suite, which found three more differences: a request missing `protocolVersion` or `clientCapabilities` in `_meta` is an invalid params error (-32602) with status 400, a version header that differs from the body is a header mismatch before the version is judged, and `initialize` on a 2026-07-28 request is not found. A browser request that reaches the endpoint from the same machine for a host that is not local is refused as DNS rebinding, when the server passes the client's `ip` to `app.fetch`.

A tool call or resource read that the app answers with a server error, a status of 500 or more, is a JSON-RPC internal error (-32603), as the specification has server errors. It was a tool result holding the app's error page. An error nothing in the app catches still leaves `app.fetch`, as from any route.
