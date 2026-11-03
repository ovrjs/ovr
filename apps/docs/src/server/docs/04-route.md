---
title: Route
description: ovr application routes.
---

## Create

ovr's built-in router offers efficient matching, supporting static paths, [parameters](#parameters), and [wildcards](#wildcard). Utilizing a [radix trie](https://en.wikipedia.org/wiki/Radix_tree) structure ensures performance does not degrade as more routes are added.

Create a route to a specific resource in your application with the `Route` class. Construct the route with an HTTP `method` and the route `pattern`, then add the [`middleware`](/05-middleware) that handles the request with `use`.

```ts
import { Route } from "ovr";

const route = new Route("GET", "/").use(() => "html");
```

Each method adds to the route and returns it, so a route reads as a chain. `params` and `fields` declare the types the middleware sees, so they come before `use`, which throws otherwise.

```ts
const update = Route.post("/posts/:id")
	.describe("Change a post's title or body") // for agents
	.params({ id: Schema.string().uuid() }) // checked before the middleware
	.fields({ title, body }) // parsed by c.data()
	.use(async (c) => {
		const session = await c.session();
		if (!session) return c.redirect("/login", 303);
		// ...
	});
```

## Parameters

Create a parameter for a route by prefixing a segment with a colon `:`.

The pattern `/api/:id` sets `Context.params.id` to the actual path segment requested, for example `/api/123`. The name of the parameter is extracted from the pattern using TypeScript to ensure `Context.params` always has the correct type.

```ts
new Route("GET", "/api/:id").use((c) => {
	// matches "/api/123"
	c.params.id; // "123"
});
```

Parameters are strings from the URL. Check them with a [schema](/07-schema) before using them, for example before a query. `params` parses each one before the route's middleware runs, and a parameter that fails its schema responds with a 404, since that resource does not exist.

```ts
import { Route, Schema } from "ovr";

const post = Route.get("/posts/:id/:slug")
	.params({ id: Schema.number().preprocess(Number).int() })
	.use(async (c) => {
		c.params.id; // number
		c.params.slug; // string, no schema
	});
```

The 404 has an empty body, so global middleware that renders a not found page renders it here too. A table's columns are schemas, so `params({ id: posts.shape.id })` checks an ID the same way the database does.

## Wildcard

Use an asterisk `*` to match all remaining segments in the route.

```ts
new Route("GET", "/files/*").use((c) => {
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
const page = Route.get("/").use(() => {
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

```tsx
const login = Route.post("/login").use(async (c) => {
	const data = await c.req.formData();
	// ...
	c.redirect("/", 303);
});

const page = Route.get("/").use(() => {
	return (
		<main>
			{/* <form method="POST" action="/login" enctype="multipart/form-data"> */}
			<login.Form>...</login.Form>

			{/* <button formmethod="POST" formaction="/login" formenctype="multipart/form-data"> */}
			<login.Button>Submit</login.Button>
		</main>
	);
});
```

Patterns can have parameters, like any route, and the route's `Form` and `Button` take their values with `params`.

```tsx
const remove = Route.post("/posts/:id/delete").use((c) => {
	// ...
});

<remove.Form params={{ id: post.id }}>
	<button>Delete</button>
</remove.Form>;
```

## Describe

`describe` explains what the route does for AI agents. Only described routes become tools for agents that connect to the app's [MCP endpoint](/10-agents) or use the page's forms, and the description says when to use them. Write it for a reader who sees the route without your UI.

```ts
const remove = Route.post("/posts/:id/delete")
	.describe("Delete a post permanently")
	.use(async (c) => {
		// ...
	});
```

GET routes are read-only tools. Every other tool may change data, so agents' clients can ask the user before calling it. The tool's name is generated from the method and pattern, for example `post_posts_id_delete`.

`describe(false)` also hides a page from agents, which can otherwise read it as Markdown. Auth hides its pages, such as its browser script, this way.

## Props

Components created via helpers have the following props available:

- `params` - if the route's pattern has parameters, they must be passed as a prop to properly construct the URL.
- `search` - [URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams) to append to the URL, passed into `URLSearchParams` constructor to create the query string.
- `hash` - [fragment hash](https://developer.mozilla.org/en-US/docs/Web/API/URL/hash) appended with a `#` at the end of the URL.

```tsx
const page = Route.get("/hello/:name").use(() => {
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
const page = Route.get("/hello/:name").use((c) => (
	<h1>Hello {c.params.name}</h1>
));
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
type Params = Route.Params<typeof page>; // { name: string }
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
