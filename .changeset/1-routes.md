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

- **Pattern:** `Route.post(pattern)` requires a pattern, and the generated hash patterns are removed.
- **Order:** `params()` and `fields()` come before `use()`, since middleware is typed by them.
- **Mounting:** `route.middleware` is a read-only copy; add middleware with `use`. Once `app.use()` mounts a route it is final, and configuring it throws.
- **URLs:** `route.pathname()` is removed: `route.url({ params })` builds the path, typed exactly when it has no `search` or `hash`. It takes a parameter as a string, a number, or a bigint, as `Anchor`, `Form`, and `Button` do, and fills parameters and wildcards anywhere in a segment, such as `/file-:id`. It throws for a parameter that would leave its segment, be empty, `.`, or `..`, or make the path start with `//`.
- **Encoding:** `url()` and the route components encode parameter values, so a value such as `a/b?c` stays in its own segment. Matched parameters are decoded for handlers: `/api/a%20b` gives `"a b"`. Apps that decode parameters themselves should stop. A wildcard keeps an encoded `/` or `\`, and never starts with `/`, so joining it to a folder cannot leave the folder.
- **Trailing slash:** a request is redirected to the other spelling of its path only when no route matches it and the other spelling matches one.
- **Request data:** `c.data()` reads a route's fields from the body for every method except GET and HEAD, which read the URL. PUT, PATCH, and DELETE routes with fields read the URL before.
- **Context types:** `Context` is exported and is what reads a request: `req`, `url`, `ip`, `params`, `route`, `session()`, `memo()`, and `cookie.get()`. `Middleware.Context` is what answers it, and adds `res`, `cookie.set`, `redirect`, `html`, `json`, `text`, `markdown`, `etag`, `data`, and `multipart`. A middleware's `c` fits wherever a `Context` is asked for. `Middleware.Context.Cookie.Options` is `Context.Cookie.Options`.
- **Middleware on its own:** a `Middleware` written outside a route fits any route, where it was a type error on a route with fields. Its `c.params` values are `unknown`, and `c.data()` is the route's parsed fields or `null`.
- **CSRF:** a request with neither `Sec-Fetch-Site` nor `Origin` and without cookies is allowed. Browsers always send one of the headers, so clients that are not browsers, such as an agent, can post.
- **Runtimes:** ovr uses native Base64, `CompressionStream`, and WebAuthn JSON APIs, and supports the latest Node.js LTS release and current browsers.

**New**

- **`route.params(schemas)`** checks and converts pattern parameters before the middleware runs, types `c.params` with the converted values, and answers 404 when one fails.
- **`route.describe(text, options)`** describes the route for AI agents, see the agents entry.
- **Client IP:** `app.fetch(request, { ip })` takes the client's IP from the server, as `c.ip`. It is never read from a header.
- **`c.memo(fn)`** returns `fn`, run once for each set of arguments for the rest of the request, so components that read the same rows query once.
- **`c.markdown(source)`** answers with Markdown.
- **HEAD:** a route for `HEAD` runs for a HEAD request. One without its own still finds GET's.
- **`c.etag()`** answers 304 when `If-None-Match` holds the tag as a weak one, in a list, or is `*`.
- **Responses:** a returned `Response` keeps each of its `Set-Cookie` headers. Content returned with a `Content-Type` such as `Text/HTML` or `text/html ; charset=utf-8` is escaped as markup, since media types ignore case and spaces.
- **Cookies:** a cookie's value ends at its `;`, so a quote in one cookie cannot take in the cookie after it.
