---
"ovr": minor
---

`Context` is what reads a request, and `Middleware.Context` is what answers it.

```tsx
import type { Context, Middleware } from "ovr";

// a component, or any function that only reads
function NavLink(props: { href: string }, c: Context) {
	c.url; // also req, ip, params, route, session(), memo(), cookie.get()
	c.redirect("/"); // type error
}

// a function of your own that answers the request
const gone = (c: Middleware.Context) => c.text("Gone", 410);
```

- A component runs once the response has begun, so a header, a cookie, or a redirect from one was lost with no error. A component's `Context` no longer has them: `res`, `cookie.set`, `redirect`, `html`, `json`, `text`, `markdown`, `etag`, `data`, and `multipart` are a `Middleware.Context`'s.
- A middleware's `c` fits wherever a `Context` is asked for. Name `Middleware.Context` only for a function that answers the request.
- `auth.forms(c)`, `auth.login(c)`, and `auth.logout(c)` take a `Middleware.Context`, since they set cookies. `auth.passkeys(c)`, `auth.remove(c, id)`, `auth.agents(c)`, and `auth.disconnect(c, client)` take a `Context`, as a form's `issues(c)`, `values(c)`, and `component(c, props)` do.
