---
"ovr": major
---

Routes are defined with a chain. `Route.get(pattern)`, `Route.post(pattern)` and `new Route(method, pattern)` take no middleware; add it with `route.use(...middleware)`, and form fields with `route.fields(shape)`:

```ts
// before
const create = Route.post("/posts", { title }, handler);

// after
const create = Route.post("/posts").fields({ title }).use(handler);
```

- **Chain:** each step returns the route. `route.params(schemas)` checks and converts pattern parameters before the middleware runs, types `c.params` with the converted values, and responds 404 when one fails. `route.describe(text)` describes the route for AI agents; undescribed routes are never served to them. `Route.post(pattern)` requires a pattern, and the generated hash patterns are removed.
- **Middleware on its own:** a `Middleware` written outside a route fits any route, including one with fields or converted parameters, where it was a type error on a route with fields. Its `c.params` values are `unknown`, and `c.data()` is the route's parsed fields or `null`.
- **Mounting:** `route.middleware` is a read-only copy; add middleware with `use`. Once `app.use()` mounts a route, it is final, and configuring it throws.
- **URLs:** `route.pathname()` is removed: `route.url({ params })` builds the path, typed exactly when it has no `search` or `hash`. It fills parameters and wildcards anywhere in a segment, such as `/file-:id` and `/files-*`, and takes a parameter as a string, a number, or a bigint, as a `params` schema may have converted it, as do `Anchor`, `Form`, and `Button`. It throws for a parameter that would leave its segment, be empty, `.`, or `..`, and when a value would make the path start with `//`, which browsers read as another host.
- **Encoding:** `url()` and the route components encode parameter values, so a value such as `a/b?c` stays in its own segment, and a wildcard keeps its slashes. Matched parameters are decoded for handlers and `params` schemas: `/api/a%20b` gives `"a b"`. A wildcard keeps an encoded `/` or `\`, so a request cannot add segments to its path, and a malformed escape is left as sent. Apps that decode parameters themselves should stop.
- **Wildcards:** a wildcard param never starts with `/`: `/files//etc/passwd` gives `"etc/passwd"`, so joining it to a folder cannot leave the folder.
- **Trailing slash:** a request no route matches is redirected only when the other spelling of its path matches a route. A matched route always answers, so its handler no longer runs and is then replaced by a redirect.
- **Request data:** `c.data()` reads a route's fields from the request body for every method except GET and HEAD, which read the URL. PUT, PATCH, and DELETE routes with fields read the URL before.
- **Responses:** a returned `Response` keeps each of its `Set-Cookie` headers, added to cookies already set. Content returned with a `Content-Type` such as `Text/HTML` or `text/html ; charset=utf-8` is escaped as markup, since media types ignore case and spaces. Parameter names in `Content-Type` and `Content-Disposition`, such as `Boundary`, match in any case.
- **Runtimes:** ovr uses native Base64 and WebAuthn JSON APIs, such as `Uint8Array.toBase64` for form state, and supports only the latest Node.js LTS release and current browsers. The runtime support policy is documented, without a package `engines` restriction.
- **CSRF:** the app allows requests with neither `Sec-Fetch-Site` nor `Origin` and without cookies. Browsers always send at least one of the headers, so non-browser clients, such as an agent submitting a form, can post.
