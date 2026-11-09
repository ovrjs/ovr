---
title: Route
description: ovr application routes.
---

## Create

ovr's built-in router offers efficient matching, supporting static paths, [parameters](#parameters), and [wildcards](#wildcard). Utilizing a [radix trie](https://en.wikipedia.org/wiki/Radix_tree) structure ensures performance does not degrade as more routes are added.

Create a route to a specific resource in your application with the `Route` class. Construct the route with an HTTP `method` and the route `pattern`, then add the [`middleware`](/middleware) that handles the request with `use`.

```ts
import { Route } from "ovr";

const route = new Route("GET", "/").use(() => "html");
```

Each method adds to the route and returns it, so a route reads as a chain. `params` checks the pattern's [parameters](#parameters), `fields` declares the form `c.data()` parses (see [POST forms](/schema#post-forms)), and `describe` explains the route to [agents](#describe). `params` and `fields` set the types the middleware sees, so they come before `use`, which throws otherwise. Once `app.use()` mounts a route, it is final: changing it throws, so its tool and middleware stay as they were mounted.

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

The pattern `/api/:id` sets `Context.params.id` to the actual path segment requested, for example `/api/123`, decoded, so `/api/a%20b` gives `"a b"`. The name of the parameter is extracted from the pattern using TypeScript to ensure `Context.params` always has the correct type.

```ts
new Route("GET", "/api/:id").use((c) => {
	// matches "/api/123"
	c.params.id; // "123"
});
```

Parameters are strings from the URL. Check them with a [schema](/schema) before using them, for example before a query. `params` parses each one before the route's middleware runs, and a parameter that fails its schema responds with a 404, since that resource does not exist.

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

The wildcard is decoded too, except for encoded `/` and `\`, so a request cannot add segments to the path: `/files/..%2Fsecret` gives `"..%2Fsecret"`, not `"../secret"`.

It can follow other text in its segment, as in `/files-*`, but not a parameter: nothing would tell where `/:id*` ends the parameter and starts the wildcard, so the pattern is a type error. Use `/:id/*`.

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

`Route.get` creates a [GET](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/GET) route with `Anchor`, `Form`, and `Button` components that link to it, so changing the route's pattern never leaves a stale link. Use `Anchor` for links and `Form` for forms that submit to the route, such as a search.

```tsx
const page = Route.get("/").use(() => {
	return (
		<main>
			{/* <a href="/">Home</a> */}
			<page.Anchor>Home</page.Anchor>

			{/* <form method="GET" action="/"><button>Submit</button></form> */}
			<page.Form />
		</main>
	);
});
```

## Post

`Route.post` creates a [POST](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/POST) route with `Form` and `Button` components. Use `Form` whenever a page submits to the route. It sets `enctype="multipart/form-data"`, and renders the route's [`fields`](/schema#post-forms) and a submit button, labelled with `submit`:

```tsx
const create = Route.post("/posts")
	.fields({ title: Field.text() })
	.use(async (c) => {
		const result = await c.data();
		// ...
	});

const page = Route.get("/").use((c) => (
	// the title field and an "Add post" button
	<create.Form state={c.url} submit="Add post" />
));
```

A route without fields, such as a delete, renders just the button. Patterns can have parameters, like any route, and the components take their values with [`params`](#props).

```tsx
const remove = Route.post("/posts/:id/delete").use((c) => {
	// ...
});

// <form method="POST" action="/posts/1/delete" ...><button>Delete</button></form>
<remove.Form params={{ id: post.id }} submit="Delete" />;
```

Pass children to write the form's contents yourself, for example with [`Fields` or `Field`](/schema#post-forms) for a custom layout; they replace the generated fields and button.

`Button` is for a second action inside another form: a submit button whose `formaction` sends that form to this route instead. Like any `formaction` button, it does nothing outside a `<form>`, so use the route's `Form` for a standalone button.

```tsx
<update.Form params={{ id: post.id }} state={c.url}>
	<update.Fields values={post} state={c.url} />
	<button>Save</button>
	{/* submits the same form to /posts/1/preview */}
	<preview.Button params={{ id: post.id }}>Preview</preview.Button>
</update.Form>
```

## Props

The `Anchor`, `Button`, and `Form` components of `Route.get` and `Route.post` take these props to build the URL:

- `params` - if the route's pattern has parameters, they must be passed as a prop to properly construct the URL.
- `search` - [URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams) to append to the URL, passed into `URLSearchParams` constructor to create the query string.
- `hash` - [fragment hash](https://developer.mozilla.org/en-US/docs/Web/API/URL/hash) appended with a `#` at the end of the URL.

`Form` also takes `submit`, the label of its button, and for routes with [`fields`](/schema#post-forms), `state`, the current page's `c.url` so an invalid submission returns to it, and `values`, a record's current values to [edit](/schema#edit-a-record).

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

## Describe

`describe` explains what the route does for AI agents. Only described routes are served to agents that connect to the app's [MCP endpoint](/agents) or use the page's forms, as tools and, for GET routes, as pages to read; the description says when to use them. Write it for a reader who sees the route without your UI.

```ts
const remove = Route.post("/posts/:id/delete")
	.describe("Delete a post permanently")
	.use(async (c) => {
		// ...
	});
```

GET routes are read-only tools. Every other tool may change data, so agents' clients can ask the user before calling it. The tool's name is generated from the method and pattern, for example `post_posts_id_delete`.

A route without a description is not served through MCP, so adding a page never lets agents read it there. The page itself is still served, as Markdown too to any request that asks for it, so protect private pages by checking the session. See [Agents](/agents) for how tools and pages are served to agents.

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

### URL

The `url` method creates a _relative_ URL (without the `origin`) for the route. It inserts params into the pattern, encoded so a value stays in its own segment: `{ name: "a/b" }` gives `/hello/a%2Fb`, and the route decodes it back to `"a/b"`. A wildcard keeps its slashes.

Given the pattern `/hello/:name`, the `name` param is required, and the result is typed by the path it builds:

```ts
page.url({ params: { name: "world" } }); // `/hello/${string}`
page.url({ params: { name: "world" } as const }); // "/hello/world"
```

Using incorrect params results in a type error:

```ts
page.url({ params: { id: "world" } });
// Error: 'id' does not exist in type '{ name: string; }'
```

> You can create a list of exact paths for given params:

```ts
const params = [
	{ name: "world" },
	{ name: "ross" },
] as const satisfies Route.Params<typeof page>[];

const paths = params.map((params) => page.url({ params }));

// ("/hello/world" | "/hello/ross")[]
```

It also takes [`search`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) and [`hash`](https://developer.mozilla.org/en-US/docs/Web/API/URL/hash) options, which make the result a `string`:

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
