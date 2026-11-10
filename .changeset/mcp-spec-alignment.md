---
"ovr": patch
---

The MCP endpoint follows the 2026-07-28 specification more closely: a missing resource is an invalid params error (-32602) that names its URI, where it was -32002; `resources/read` results carry the required `ttlMs` and `cacheScope`, private when agents sign in; and `ping`, which that version removed, is not found. The earlier versions keep their own behaviour.

With `auth`, a page's resource name is `page://host/path` where it was its `https` address, since the specification keeps `https` names for what an agent can fetch itself, and these pages need the user's session. `resources/read` takes either form, and links inside a page stay real addresses. Apps without `auth` keep `https` names.
