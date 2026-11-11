---
title: Middleware
description: Understand how ovr handles each request.
---

## Create

Middleware are functions that are composed together to handle requests. Most middleware is written inline, passed to a route's `use`. Middleware can also be created on it's own to be used globally or to apply to routes.

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

For each request, ovr creates an array containing the **global** middleware, then the **matched route**'s middleware (if there is a match). An [MCP endpoint](/agents#mcp) is the exception, with the endpoints agents [sign in](/agents#sign-in) through, its OAuth metadata documents, `/oauth/authorize`, and `/oauth/token`: they are the way in for agents and not pages of your app, so they run without global middleware, and the request the MCP endpoint makes to a route for an agent passes through them. What must cover every request, such as an IP blocklist or a maintenance page, belongs in front of the app, at your server or proxy.

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

`Context` exposes the current `Request` on `req`, the parsed [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) on `url`, type-safe route [`params`](/route#parameters), the matched `route`, the signed-in [session](/auth#sessions), and helpers for cookies and request parsing.

```ts
Route.get("/api/:id").use((c) => {
	c.req; // original `Request`
	c.ip; // trusted client IP supplied by your server, or undefined
	c.url; // parsed web `URL`
	c.params; // type-safe route parameters { id: "123" }
	c.route; // matched `Route`
	c.session(); // signed-in session, with app.use(auth)
	c.cookie.get(name); // get cookie
	c.multipart(); // multipart form data, part by part
	c.data(); // the route's fields, parsed
});
```

> On [routes with fields](/schema#post-forms), `Context.data` parses typed form data from the request body. On [GET routes](/schema#get-forms) it parses typed search params. Routes without fields return `null`.

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
	c.redirect(location, status); // redirect to a location, or a route without parameters

	c.cookie.set(name, value, options); // set cookie

	if (c.etag(str)) return; // ETag - sets 304 if match
	if (c.md(source, status)) return; // Markdown source, when it is asked for, see Agents

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

Any value that is returned from middleware will be passed into [`Markup.stream`](/render#stream), or [`Markdown.stream`](/render#markdown) when the request asks for Markdown, and assigned to `Context.res.body`.

Returning a value sets the `content-type` header to `html` unless it has already been set. Markup content types such as `html`, `xml`, and `svg` will be escaped during the render while other content types will not.

> Middleware's flexible return type makes it easy to stream other types of content than HTML. Simply set the `content-type` header before returning. Check out the demos for [SSE](/demo/sse) or [XML](/demo/seo) for examples.

## Not found and errors

Two global middleware cover the requests no route answers and the ones a route fails. Pass them to `app.use` first, so they run around everything after them.

```tsx
import { App, type Middleware } from "ovr";

const errors: Middleware = async (c, next) => {
	try {
		await next();
	} catch (error) {
		console.error(error); // or your error tracker

		c.res.status = 500;
		// a type the route set before it failed, such as JSON
		c.res.headers.delete("content-type");

		return (
			<main>
				<h1>Something went wrong</h1>
			</main>
		);
	}
};

const notFound: Middleware = async (c, next) => {
	await next();

	// no route matched, or one set a status without a body
	if (c.res.body === undefined) {
		c.res.status = 404;

		return (
			<main>
				<h1>Not found</h1>
			</main>
		);
	}
};

const app = new App().use(errors, notFound, home, posts);
```

ovr does not catch what your code throws, and it never logs. Without the first middleware an error leaves `app.fetch`, where your server logs it and answers 500, so reporting the error is yours to do in the `catch`.

- A request body the client got wrong is not an error of your app's: the route's [413, 415, or 400](/schema#protections) is answered before this middleware, which sees only the response.
- An error thrown while a page streams, such as in an async component, comes after the response has started, so it ends the stream instead of reaching the middleware.
- An error in the [MCP endpoint](/agents#mcp) itself or in an agent's sign-in, such as the database failing while it checks a token, is outside global middleware, so it leaves `app.fetch` for your server to report.
- Both pages are written as Markdown for a request that asks for it, and through [MCP](/agents#tools) an agent receives the protocol's internal error in place of your error page.

## Rate limiting

[Auth](/auth#rate-limiting) limits sign-in and agent sign-in for you. Add a `Limiter` to your own routes that are expensive, such as ones that send email or call an AI model. It stores token buckets in your Postgres [database](/database), so every server counts together.

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

Without `key`, a limiter counts each client IP, which your server passes with `app.fetch(request, { ip })`, see [client IP examples](/app#client-ip).

A limiter counts agents too, as it counts people: by the requests that reach your routes. The [MCP endpoint](/agents#mcp) makes a request to the route for each [tool call](/agents#tools), and follows a redirect as a browser does, so a form that redirects is two requests for either. A limiter passed to `app.use` does not see the endpoint's own requests, such as listing tools; limit those at your server or proxy if you need to.

The default key is the trusted `c.ip`, with IPv6 grouped by `/64` and mapped IPv4 addresses sharing their IPv4 budget. A `key` that returns nothing throws, so put a limiter keyed by user after a sign-in check, as above. Cookies and forwarded headers are never used as fallback identities. Exhausted buckets return HTTP 429 with `Retry-After` and `Cache-Control: no-store`. A missing or invalid identity, or a storage failure, throws: the request is not admitted, and your app's error handling sees the error like one from your own handler.

The first argument names the limiter's buckets. Name each limiter: two with the same name and policy share their buckets, which is how separate servers using one database count together, but two limiters stacked on one route would then spend a request's tokens twice. Keep the name when you deploy, since a new name starts every client with a full budget.

`database` is required. Optional settings are `limit` (default 60), `interval` (milliseconds, default a minute), and `key`. IPv6 addresses are grouped by `/64`, the network one home or office gets; NAT64 and other translated addresses may share one, so use a custom key when those are the peers your deployment sees. IPv4 metadata must use four decimal octets without leading zeroes; ambiguous or abbreviated forms are rejected. `await limiter.check(c, scope)` returns `true` or a retry `Date`, and different scopes have independent budgets. The algorithm uses continuously replenished token buckets to avoid fixed-window boundary bursts.

Buckets are stored in `Limiter.table`, named `rate_limits`. Include it in your database's tables, and [`database.migrate()`](/database#migrate) creates it before your own migrations; `new Limiter()` is a type error when it is missing. `Auth.tables` already includes it, so an app using Auth adds nothing.

```ts
const database = new Database(pool, [posts, Limiter.table]);
```

Each admitted request refills and consumes a token in one atomic statement, so every worker shares one budget and a fresh function instance does not receive a fresh budget. Expired buckets are deleted periodically as new ones are written. Database failures fail closed. Keys include `name`, `limit`, and `interval`, so different policies never interpret the same token balance. Identical policies with the same name, scope, and identity intentionally share a budget, so give independent route quotas distinct names. Changing a policy creates a fresh bucket.

Network-level and distributed abuse protection still belong at your deployment edge.

A limiter mounted for every route with `app.use(limiter.middleware)` also counts Auth's requests, in its own budget, apart from Auth's limits; a sign-in then spends from both. Limiting selected routes avoids that.

When composing client and aggregate middleware, check the client policy before tighter shared quotas. Every successful check consumes its token even if a later policy denies, so placing a tight aggregate quota first lets an already-blocked client drain shared capacity.
