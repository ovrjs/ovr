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

ovr creates `Context` _(in these docs it's abbreviated as `c`)_ with the current request, then passes it as the first argument into each middleware function to be read and modified.

## Request

`Context.req` contains information about the current request such as the [`url`](https://developer.mozilla.org/en-US/docs/Web/API/URL) or [`params`](/06-routing#parameters).

```ts
Route.get("/api/:id", (c) => {
	c.req; // original `Request`
	c.url; // parsed web `URL`
	c.params; // type-safe route parameters { id: "123" }
	c.route; // matched `Route`
	c.cookie.get(name); // get cookie
	c.form(); // multipart form data
});
```

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
	c.redirect(location, status); // redirect

	c.cookie.set(name, value, options); // set cookie

	if (c.etag(str)) return; // ETag - sets 304 if match

	// return anything from middleware (see next section)
	return <p>stream</p>;
});
```

### Return value

ovr handles the return value from middleware in two ways.

1. **Response** - If a `Response` is returned from middleware, `Context.res.body`, `Context.res.status` will be set to the response's values, and its `headers` will be merged into `Context.res.headers`.

```ts
app.use(() => new Response("Hello world"));
```

2. **Stream**

Any value that is returned from middleware will be passed into [`Render.stream`](/02-render#stream) and assigned to `Context.res.body`.

Returning a value sets the content type header to HTML unless it has already been set. HTML will be escaped during the render while other content types will not.

This makes it easy to stream other types of content than HTML. For example, to create a [server sent event](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) stream, simply set the content type header and return a generator function:

```ts
// simulate latency
const delay = () => new Promise((r) => setTimeout(r, 500));

Route.get("/api/:id", (c) => {
	// set the content type header to create a SSE
	c.res.headers.set("content-type", "text/event-stream");

	// passed into `render.stream`
	return async function* () {
		yield "data: server\n\n";
		await delay();
		yield "data: sent\n\n";
		await delay();
		yield "data: event\n\n";
	};
});
```

> ovr JSX can be used to create streams of other types of content too without using the intrinsic HTML elements.
