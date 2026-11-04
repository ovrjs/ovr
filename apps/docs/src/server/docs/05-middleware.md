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

`Context` exposes the current `Request` on `req`, the parsed [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) on `url`, type-safe route [`params`](/04-route#parameters), the matched `route`, the signed-in [session](/09-auth#sessions), and helpers for cookies and request parsing.

```ts
Route.get("/api/:id").use((c) => {
	c.req; // original `Request`
	c.ip; // trusted client IP supplied by your server, or undefined
	c.url; // parsed web `URL`
	c.params; // type-safe route parameters { id: "123" }
	c.route; // matched `Route`
	c.session(); // signed-in session, with app.use(auth)
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
Route.get("/api/:id").use((c) => {
	c.res.body = "# Markdown"; // BodyInit | null | undefined
	c.res.status = 200; // number | undefined
	c.res.headers.set("content-type", "text/markdown; charset=utf-8"); // Headers
});

// internally, ovr creates the Response with final values:
new Response(c.res.body, { status: c.res.status, headers: c.res.headers });
```

The response can be also be set with helper functions or by returning a value from the middleware.

```tsx
Route.get("/api/:id").use((c) => {
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

[Auth](/09-auth#rate-limiting) limits sign-in and agent sign-in for you. Add a `Limiter` to your own routes that are expensive, such as ones that send email or call an AI model. It stores token buckets in your Postgres [database](/08-database), so every server counts together.

```ts
import { Limiter, type Middleware, Route } from "ovr";

const signedIn: Middleware = async (c, next) => {
	if (!(await c.session())) return c.redirect("/login", 303);
	return next();
};

// 10 per minute for each signed-in user
const generate = new Limiter("generate", {
	database,
	limit: 10,
	key: async (c) => (await c.session())?.user,
});

app.use(
	Route.post("/generate").use(signedIn, generate.middleware, async (c) => {
		// ...
	}),
);
```

Without `key`, a limiter counts each client IP, which your server passes with `app.fetch(request, { ip })`, see [client IP examples](/03-app#client-ip).

The default key is the trusted `c.ip`, with IPv6 grouped by `/64` and mapped IPv4 addresses sharing their IPv4 budget. A `key` that returns nothing throws, so put a limiter keyed by user after a sign-in check, as above. Cookies and forwarded headers are never used as fallback identities. Exhausted buckets return HTTP 429 with `Retry-After` and `Cache-Control: no-store`. A missing or invalid identity, or a storage failure, throws: the request is not admitted, and your app's error handling sees the error like one from your own handler.

The first argument names the limiter's buckets. Name each limiter: two with the same name and policy share their buckets, which is how separate servers using one database count together, but two limiters stacked on one route would then spend a request's tokens twice. Keep the name when you deploy, since a new name starts every client with a full budget.

`database` is required. Optional settings are `limit` (default 60), `interval` (milliseconds, default a minute), and `key`. IPv6 addresses are grouped by `/64`, the network one home or office gets; NAT64 and other translated addresses may share one, so use a custom key when those are the peers your deployment sees. IPv4 metadata must use four decimal octets without leading zeroes; ambiguous or abbreviated forms are rejected. `await limiter.check(c, scope)` returns `true` or a retry `Date`, and different scopes have independent budgets. The algorithm uses continuously replenished token buckets to avoid fixed-window boundary bursts.

Buckets are stored in `Limiter.table`, named `rate_limits`. Include it in your database's tables, and [`database.migrate()`](/08-database#migrate) creates it before your own migrations; `new Limiter()` throws when it is missing. `Auth.tables` already includes it, so an app using Auth adds nothing.

```ts
const database = new Database(pool, [posts, Limiter.table]);
```

Each admitted request refills and consumes a token in one atomic statement, so every worker shares one budget and a fresh function instance does not receive a fresh budget. Expired buckets are deleted as new ones are written. Database failures fail closed. Keys include `name`, `limit`, and `interval`, so different policies never interpret the same token balance. Identical policies with the same name, scope, and identity intentionally share a budget, so give independent route quotas distinct names. Changing a policy creates a fresh bucket.

Network-level and distributed abuse protection still belong at your deployment edge.

A limiter mounted for every route with `app.use(limiter.middleware)` also counts Auth's requests, in its own budget, apart from Auth's limits; a sign-in then spends from both. Limiting selected routes avoids that.

When composing client and aggregate middleware, check the client policy before tighter shared quotas. Every successful check consumes its token even if a later policy denies, so placing a tight aggregate quota first lets an already-blocked client drain shared capacity.
