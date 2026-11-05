---
"ovr": major
---

Fixes from an independent review:

- **Trailing slash:** a request no route matches is redirected only when the other spelling of its path matches a route. A matched route always answers, so its handler no longer runs and is then replaced by a redirect.
- **Multipart:** the parser skips the rest of a part its reader stopped reading, so a file's bytes are never parsed as further fields. A part that ends without its boundary, a body without the closing delimiter, and one without an opening boundary throw `TypeError`; a form without fields, only the closing delimiter, still parses. Boundary searches are linear whatever boundary the client chooses. Quoted header parameters can contain `;` and escaped quotes.
- **Routes:** `route.url()` throws for a parameter that would leave its segment: empty, `.`, or `..`. A wildcard after other text, such as `/files-*`, is filled in. `c.redirect(route)` throws for a route with parameters, use `route.url({ params })`. `route.params()` checks whole parameter names.
- **Responses:** a returned `Response` keeps each of its `Set-Cookie` headers, added to cookies already set.
- **Forms:** field names such as `constructor` are unexpected fields, not inherited properties.
- **Markdown for agents:** large code and tables no longer overflow the stack, and option values and field names cannot start lines of their own.
- `Render.string(element)` is static, like `Render.stream`.
- `Limiter.Context` includes `session`, so a `key` can count each signed-in user.
- Tables can store dates inside JSON columns, as ISO strings read back as dates.
- **Agent sign-in:** downloads of client ID metadata documents are limited per client IP and host, with a higher limit per host in all, at most two at once per IP, and client IDs without a document are remembered for a minute, so one client cannot block an agent's host for everyone. Authorization errors are answered with a 400 page instead of being redirected to the client, client IDs must be written exactly as their URL, a used code is kept until its tokens expire so a late replay still revokes them, and an unavailable rate limiter throws to the app instead of answering 503.
