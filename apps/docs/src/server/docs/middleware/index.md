---
title: Middleware
description: Understand how ovr handles each request.
---

## Create

Middleware are functions that are composed together to handle requests. Most middleware is written inline, passed to a route's `use`. Middleware can also be created on its own to be used globally or to apply to routes.

```ts
import type { Middleware } from "ovr";

const mw: Middleware = async (c, next) => {
	c; // Middleware.Context - request context
	await next(); // Middleware.Next - dispatch the next middleware in the stack
};
```

> Middleware are just functions, use the `Middleware` type helper to easily type the parameters if you are creating them outside of a route. A `Middleware` fits any route and the app: it doesn't know the route's parameters, which a [`params`](/route#parameters) schema may have converted, so `c.params` values are `unknown`, and `c.data()` is the route's parsed fields or `null`. Give it types, such as `Middleware<{ id: number }>`, to use it only on routes that have them.

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

There are two types for it, for a function of your own that takes one:

- `Context` reads the request: `req`, `ip`, `url`, `params`, `route`, `session()`, `memo()`, and `cookie.get()`. It is what a [component](/render#context) is given.
- `Middleware.Context` is the one a middleware is given, which can also answer the request: set headers and cookies, redirect, and parse the body.

```ts
import type { Context, Middleware } from "ovr";

const signedIn = async (c: Context) => Boolean(await c.session());

const gone = (c: Middleware.Context) => c.text("Gone", 410);
```

Type a function of your own with `Context` when it only reads the request, as `signedIn` does. A handler can pass its `c` to it, since a `Middleware.Context` has everything a `Context` has. Use `Middleware.Context` only when the function answers the request, as `gone` does.

## Properties

A middleware's context has the `Request`, its parsed [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL), the route's [parameters](/route#parameters), the matched route, the [session](/auth#sessions), cookies, and the request's parsed [fields](/schema#post-forms).

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
	c.memo(fn); // fn, run once for each set of arguments
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
	if (c.markdown(source, status)) return; // Markdown source, when it is asked for, see Agents

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

Any value that is returned from middleware will be rendered to a stream with [`Render`](/render#stream), as markup, or as [Markdown](/render#markdown-output) when the request asks for Markdown, and assigned to `Context.res.body`.

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

	// no route matched, or one set a status without a body. A route's own
	// 404 has a body and `c.res.status === 404`: check that too to replace it.
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
- An error thrown while a page streams, such as in an async component, comes after the response has started, so it ends the stream instead of reaching the middleware. See [errors while a page streams](/pages#errors-while-a-page-streams) for what to keep in the route.
- An error in the [MCP endpoint](/agents#mcp) itself or in an agent's sign-in, such as the database failing while it checks a token, is outside global middleware, so it leaves `app.fetch` for your server to report.
- Both pages are written as Markdown for a request that asks for it, and through [MCP](/agents#tools) an agent receives the protocol's internal error in place of your error page.

## Rate limiting

[Auth](/auth#rate-limiting) limits sign-in and agent sign-in for you. Add a `Limiter` to your own routes that are expensive, such as ones that send email or call an AI model. It stores token buckets in your Postgres [database](/database), so every server counts together.

```ts
import { Limiter, Route } from "ovr";

// redirects anyone who is not signed in, see auth.guard
const signedIn = auth.guard((c, next) => next());

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

Without `key`, a limiter counts each client IP, which your server passes with [`app.fetch(request, { ip })`](/app#client-ip). A `key` that returns nothing throws, so put a limiter keyed by user after a sign-in check, as above.

| Option     | Value                                           |
| ---------- | ----------------------------------------------- |
| `database` | Where the buckets are stored, required          |
| `limit`    | Requests in each interval, 60 by default        |
| `interval` | Milliseconds, a minute by default               |
| `key`      | Who a request counts against, the IP by default |

- **Over the limit** the response is a 429 with `Retry-After`.
- **Every server counts together**, since the buckets are in your database. A request that can't be counted, such as when the database is down, is not let through: it throws, and your error handling sees it.
- **The first argument names the buckets.** Give each limiter its own name, and keep it across deploys, since a new name starts everyone with a full budget.
- **Agents are counted as people are**, by the requests that reach your routes: the [MCP endpoint](/agents#mcp) makes one for each [tool call](/agents#tools). It does not count the endpoint's own requests, such as listing tools.
- **`await limiter.check(c, scope)`** checks without the middleware, and returns `true` or the `Date` to retry at. Each scope has its own budget.

Buckets are stored in `Limiter.table`, named `rate_limits`. Include it in your database's tables, and [`database.migrate()`](/database#migrate) creates it. `Auth.tables` already includes it.

```ts
const database = new Database(pool, [posts, Limiter.table]);
```

A limiter given to `app.use` for every route also counts Auth's requests, apart from Auth's own limits. With more than one limiter on a route, put the one for each client first: every check that passes spends a token, even when a later one refuses.
