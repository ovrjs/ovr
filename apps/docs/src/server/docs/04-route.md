---
title: Route
description: ovr application routes.
---

## Create

ovr's built-in router offers efficient matching, supporting static paths, [parameters](#parameters), and [wildcards](#wildcard). Utilizing a [radix trie](https://en.wikipedia.org/wiki/Radix_tree) structure ensures performance does not degrade as more routes are added.

Create a route to a specific resource in your application with the `Route` class. Construct the route with an HTTP `method`, the route `pattern`, and the [`middleware`](/05-middleware) to handle the request.

```ts
import { Route } from "ovr";

const route = new Route("GET", "/", () => "html");
```

## Parameters

Create a parameter for a route by prefixing a segment with a colon `:`.

The pattern `/api/:id` sets `Context.params.id` to the actual path segment requested, for example `/api/123`. The name of the parameter is extracted from the pattern using TypeScript to ensure `Context.params` always has the correct type.

```ts
new Route("GET", "/api/:id", (c) => {
	// matches "/api/123"
	c.params.id; // "123"
});
```

## Wildcard

Use an asterisk `*` to match all remaining segments in the route.

```ts
new Route("GET", "/files/*", (c) => {
	c.params["*"]; // matched wildcard path (ex: "images/logo.png")
});
```

## Prioritization

Routes are prioritized in this order:

**Static** > **Parametric** > **Wildcard**

Given three routes are added in any order:

```ts
app.use(new Route("GET", "/hello/*"));
app.use(new Route("GET", "/hello/world"));
app.use(new Route("GET", "/hello/:name"));
```

More specific matches are prioritized. The following pathnames would match the corresponding patterns:

| Pathname            | Pattern        |
| ------------------- | -------------- |
| `/hello/world`      | `/hello/world` |
| `/hello/john`       | `/hello/:name` |
| `/hello/john/smith` | `/hello/*`     |

## Get

`Route.get` makes it easy to create a [GET](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/GET) route and corresponding `Anchor`, `Button`, and `Form` components for it. This ensures if you change the route's pattern, you don't need to update all of the links to it throughout your application. Anytime you need to generate a link to a route use the `Anchor` component.

```tsx
const page = Route.get("/", () => {
	return (
		<main>
			{/* <a href="/"> */}
			<page.Anchor>Home</page.Anchor>

			{/* <button formmethod="GET" formaction="/"> */}
			<page.Button>Submit</page.Button>

			{/* <form method="GET" action="/"> */}
			<page.Form>...</page.Form>
		</main>
	);
});
```

## Post

There is also a `Route.post` function that will create a [POST](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/POST) route and corresponding `Form` and `Button` elements. Anytime you need to handle a form submission, use the generated `Form` component. These components also automatically set the `enctype=multipart/form-data` attribute.

For `Route.post`, ovr will automatically generate a unique pathname for the route based on a hash of the middleware provided.

```tsx
const login = Route.post(async (c) => {
	const data = await c.req.formData();
	// ...
	c.redirect("/", 303);
});

const page = Route.get("/", () => {
	return (
		<main>
			{/* <form method="POST" action="/_p/generated-hash" enctype="multipart/form-data"> */}
			<login.Form>...</login.Form>

			{/* <button formmethod="POST" formaction="/_p/generated-hash" formenctype="multipart/form-data"> */}
			<login.Button>Submit</login.Button>
		</main>
	);
});
```

You can set the pattern manually if you need a stable pattern or if you are using parameters.

```tsx
const custom = Route.post("/custom/:pattern", (c) => {
	// ...
});
```

## Props

Components created via helpers have the following props available:

- `params` - if the route's pattern has parameters, they must be passed as a prop to properly construct the URL.
- `search` - [URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams) to append to the URL, passed into `URLSearchParams` constructor to create the query string.
- `hash` - [fragment hash](https://developer.mozilla.org/en-US/docs/Web/API/URL/hash) appended with a `#` at the end of the URL.

```tsx
const page = Route.get("/hello/:name", () => {
	return (
		// <form method="GET" action="/hello/world?search=param#hash">
		<page.Form
			params={{ name: "world" }}
			search={{ search: "param" }}
			hash="hash"
		>
			...
		</page.Form>
	);
});
```

## Properties

Given the following `Route`, a variety of other properties are available to use.

```tsx
const page = Route.get("/hello/:name", (c) => <h1>Hello {c.params.name}</h1>);
```

### Method

The route's HTTP method.

```ts
page.method; // "GET"
```

### Middleware

All `Middleware` added to the route.

```ts
page.middleware; // Middleware[]
```

### Params

`Params` is a type helper to get the specific params of the route based on the pattern.

```ts
typeof page.Params; // { name: string }
```

### Pattern

The pattern the route was created with.

```ts
page.pattern; // "/hello/:name"
```

### Pathname

The `pathname` method inserts params into the pattern. It provides type safety to ensure you always pass the correct params (or no params) to create the pathname.

In this case, given the pattern `/hello/:name`, the `name` property must be passed in on the `params` object.

```ts
page.pathname({ name: "world" }); // `/hello/${string}`
page.pathname({ name: "world" } as const); // "/hello/world"
```

Using incorrect params results in a type error:

```ts
page.pathname({ id: "world" });
// Error: 'id' does not exist in type '{ name: string; }'
```

> You can create a list of exact pathnames for given params:

```ts
const params = [
	{ name: "world" },
	{ name: "ross" },
] as const satisfies Route.Params<typeof page>[];

const pathnames = params.map((p) => page.pathname(p));

// ("/hello/world" | "/hello/ross")[]
```

### Relative URL

The `url` method creates a _relative_ URL (without the `origin`) for the route. This method is similar to `pathname`, but also provides the ability to also pass [`search`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) and [`hash`](https://developer.mozilla.org/en-US/docs/Web/API/URL/hash) options to create the URL.

```ts
// /hello/world?search=param#hash
const relativeUrl = page.url({
	params: { name: "world" },
	search: { search: "param" },
	hash: "hash",
});

const absoluteUrl = new URL(relativeUrl, "https://example.com");
absoluteUrl.href; // https://example.com/hello/world?search=param#hash
```
