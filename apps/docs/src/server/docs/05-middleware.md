---
title: Middleware
description: Understand how ovr handles each request.
---

## Create

Middleware are functions that are composed together to handle requests. Most middleware will be created inline as an argument when creating a route. Middleware can also be created on it's own to be used globally or to apply to routes.

```ts
import type { Middleware } from "ovr";

const mw: Middleware = async (c, next) => {
	c; // Middleware.Context - request context
	await next(); // Middleware.Next - dispatch the next middleware in the stack
};
```

> Middleware are just functions, use the `Middleware` type helper to easily type the parameters if you are creating them outside of a route.

## Composition

There are two levels of middleware in an ovr application:

1. **Global** - any middleware passed directly to `App.use`
2. **Route** - middleware added to a specific `Route`

For each request, ovr creates an array containing the **global** middleware, then the **matched route**'s middleware (if there is a match).

The first middleware in the array will be called, then you can dispatch the `next` middleware within the first by calling `await next()` or returning `next()`.

```ts
app.use(
	async (c, next) => {
		console.log("1");

		await next(); // dispatches the next middleware below

		console.log("3");
	},
	(c, next) => {
		console.log("2");

		return next(); // or `return` instead of `await`
	},
	// ...
);

// 1
// 2
// 3
```

## Context

For each request, ovr creates a `Context` object _(abbreviated as `c` in these docs)_ and passes it as the first argument to every middleware function.

## Properties

`Context` exposes the current `Request` on `req`, the parsed [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) on `url`, type-safe route [`params`](/04-route#parameters), the matched `route`, and helpers for cookies and request parsing.

```ts
Route.get("/api/:id", (c) => {
	c.req; // original `Request`
	c.ip; // trusted client IP supplied by your server, or undefined
	c.url; // parsed web `URL`
	c.params; // type-safe route parameters { id: "123" }
	c.route; // matched `Route`
	c.cookie.get(name); // get cookie
	c.form(); // multipart form data
	c.data(); // route schema data
});
```

> On [schema-enabled POST routes](/07-schema#post-forms), `Context.data` parses typed form data, and on [schema-enabled GET routes](/07-schema#get-forms) it parses typed search params. Routes without a schema return `null`.

## Response

`Context.res` stores the arguments that will be passed into `new Response()` after middleware has executed.

These properties can be set directly:

```ts
Route.get("/api/:id", (c) => {
	c.res.body = "# Markdown"; // BodyInit | null | undefined
	c.res.status = 200; // number | undefined
	c.res.headers.set("content-type", "text/markdown; charset=utf-8"); // Headers
});

// internally, ovr creates the Response with final values:
new Response(c.res.body, { status: c.res.status, headers: c.res.headers });
```

The response can be also be set with helper functions or by returning a value from the middleware.

```tsx
Route.get("/api/:id", (c) => {
	// use helper functions to set common headers
	c.html(body, status); // HTML
	c.text(body, status); // plain text
	c.json(data, status); // JSON
	c.redirect(location, status); // redirect to a location or route

	c.cookie.set(name, value, options); // set cookie

	if (c.etag(str)) return; // ETag - sets 304 if match

	// return anything from middleware (see next section)
	return <p>stream</p>;
});
```

### Return value

ovr handles the return value from middleware in one of two ways.

#### Response

If a `Response` is returned from middleware, `Context.res.body`, `Context.res.status` will be set to the response's values, and its `headers` will be merged into `Context.res.headers`.

```ts
app.use(() => new Response("Hello world"));
```

#### Stream

Any value that is returned from middleware will be passed into [`Render.stream`](/02-render#stream) and assigned to `Context.res.body`.

Returning a value sets the `content-type` header to `html` unless it has already been set. Markup content types such as `html`, `xml`, and `svg` will be escaped during the render while other content types will not.

> Middleware's flexible return type makes it easy to stream other types of content than HTML. Simply set the `content-type` header before returning. Check out the demos for [SSE](/demo/sse) or [XML](/demo/seo) for examples.

## Rate limiting

`Limiter` is reusable middleware. Authentication uses its own built-in policies automatically; ordinary routes opt in:

```ts
import { App, Limiter, Route } from "ovr";

const app = new App();
const search = new Limiter({ name: "search", consume: consumeToken }); // Default policy: 60 per minute.

app.use(
	Route.get("/search", search.middleware, (c) => c.text("Search results")),
);

// Your server supplies the trusted socket peer or verified edge client IP:
app.fetch(request, { ip });
```

The default key is the trusted `c.ip`, with IPv6 grouped by `/64` and mapped IPv4 addresses sharing their IPv4 budget. Cookies and forwarded headers are never used as fallback identities. Missing/invalid identity or limiter storage failures return HTTP 503; exhausted buckets return HTTP 429 with `Retry-After` and `Cache-Control: no-store`.

`consume` is required. Optional settings are `limit`, `interval` (milliseconds), `name`, `prefix`, `key`, and `error`. A custom `key(c)` can return an authenticated user ID; missing keys fail closed. `prefix` sets the IPv6 grouping from 1 to 128 bits, defaulting to 64, without changing IPv4. For example, use an additional `/48` policy to limit callers rotating through multiple `/64` networks. NAT64 and other translated addresses may share a prefix; choose a suitable prefix or custom key when those are the peers your deployment sees. IPv4 metadata must use four decimal octets without leading zeroes; ambiguous or abbreviated forms are rejected. `await limiter.check(c, scope)` returns `true` or a retry `Date`, and different scopes have independent budgets. The algorithm uses continuously replenished token buckets to avoid fixed-window boundary bursts.

Every request calls the shared atomic `consume(key, { limit, interval })` operation. It returns the literal boolean `true` on admission or a positive absolute retry time in milliseconds on denial; numeric `1` means denial, not success. Fractional retry timestamps round up. Failures and malformed results fail closed. All workers must share a stable `name`, storage, and policy values. Keys include `name`, `limit`, and `interval`, so different policies never interpret the same token balance. The default name is `requests`: identical policies with the same name, scope, and identity intentionally share a budget. Give independent route quotas distinct stable names. Changing a policy creates a fresh bucket; this release's key format also resets existing buckets once on deployment. Missing storage is rejected at startup. There is no built-in memory store or process-local counter cache, so a fresh function instance does not receive a fresh budget. The backend owns bucket expiration and capacity limits.

Storage keys are opaque JSON strings containing the namespace, scope, and identity; do not assume they fit a short indexed column. Their UTF-8 size also depends on escaping and application-supplied scopes. A backend with short-key limits can hash the entire UTF-8 key with SHA-256 inside `consume` before addressing its bucket. Use the same encoding in every worker and preserve the whole key when hashing; truncation can merge unrelated budgets.

Middleware failures are reported through `error(error, c)`, defaulting to `console.error`. A failing error callback is logged too, and the response remains a generic 503. Direct `check()` calls throw failures for their caller to handle; Auth reports them through its own `error` callback.

The authentication SQLite demo includes a transactional backend for processes connected to the same persistent database file. Serverless deployments need shared database storage accessible from every instance. Network-level and distributed abuse protection still belong at your deployment edge.

Use `app.use(limiter.middleware)` to apply a limiter globally. That includes auth routes and logout too; prefer selected routes when you want those requests to remain independent of a general application quota. The auth service's own policies always bypass logout.

When composing client and aggregate middleware, check the client policy before tighter shared quotas. Every successful check consumes its token even if a later policy denies, so placing a tight aggregate quota first lets an already-blocked client drain shared capacity. Authentication's `limits.extra` automatically places additional quotas after its client policy. Its optional `limits.guard` is a separate, generous request ceiling before client record creation; it counts blocked attempts too and has a deliberate capacity-versus-availability tradeoff.
