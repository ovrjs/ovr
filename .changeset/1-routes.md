---
"ovr": major
---

Routes are defined with a chain. `Route.get(pattern)`, `Route.post(pattern)` and `new Route(method, pattern)` take no middleware or fields; add them with `route.use(...middleware)` and `route.fields(shape)`:

```ts
// before
const create = Route.post("/posts", { title }, handler);

// after
const create = Route.post("/posts").fields({ title }).use(handler);
```

**Changed**

- **Pattern:** `Route.post(pattern)` requires a pattern, and the generated hash patterns are removed. A pattern that does not start with `/`, or holds a query, a fragment, or whitespace, is a type error.
- **Order:** `fields()` comes before `use()`, since middleware is typed by it.
- **Mounting:** `route.middleware` is read-only; add middleware with `use`. Once `app.use()` mounts a route, configuring it throws.
- **URLs:** `route.pathname()` is removed; use `route.url({ params })`.
- **Encoding:** `url()`, `Anchor`, `Form`, and `Button` encode parameter values, and handlers get matched parameters decoded: `/api/a%20b` gives `"a b"`. Apps that encode or decode parameters themselves should stop.
- **Request data:** PUT, PATCH, and DELETE routes with fields read them from the body, where they read the URL.
- **Redirects:** `c.redirect(route)` takes only a route without parameters; use `route.url({ params })` for one with them.
- **Types:** `Middleware.Context.Cookie.Options` is `Context.Cookie.Options`.
- **Runtimes:** ovr supports the latest Node.js LTS release and current browsers.

**New**

- **`route.params(schemas)`** checks and converts pattern parameters before the middleware runs, types `c.params` with the converted values, and answers 404 when one fails.
- **`route.describe(text, options)`** makes the route a tool for AI agents, see the agents entry.
- **`c.ip`** is the client's IP, passed by the server as `app.fetch(request, { ip })`.
- **`c.memo(fn)`** returns `fn`, run once for each set of arguments for the rest of the request, so components that read the same rows query once.
- **`c.markdown(source)`** answers with Markdown.
- **`Context`** is exported: the part of a middleware's context that reads the request, without the methods that answer it. Components are given it, see the rendering entry.
- **Parameters:** `url()`, `Anchor`, `Form`, and `Button` take a number or a bigint for a parameter.

**Fixed**

- **Middleware on its own:** a `Middleware` written outside a route fits any route, where it was a type error on a route with fields.
- **Trailing slash:** a request is redirected to the other spelling of its path only when that spelling matches a route.
- **CSRF:** a request without `Sec-Fetch-Site`, `Origin`, or cookies is allowed, so clients that are not browsers, such as an agent, can post.
- **HEAD:** a route for `HEAD` runs for a HEAD request, where GET's ran.
- **`c.etag()`** answers 304 when `If-None-Match` holds the tag as a weak one, in a list, or is `*`.
- **Responses:** a returned `Response` keeps each of its `Set-Cookie` headers. Content returned with a `Content-Type` such as `Text/HTML` or `text/html ; charset=utf-8` is escaped as markup.
- **Cookies:** a quote in one cookie no longer takes in the cookie after it.
- **Parameters in a segment:** `url()` fills a parameter that is part of a segment, such as `/file-:id`.
- **Unsafe parameters:** `url()` throws for a parameter that is empty, `.`, or `..`, would leave its segment, or would make the path start with `//`. A wildcard never starts with `/`, so joining it to a folder cannot leave the folder.
