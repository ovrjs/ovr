---
title: Render
description: Easily parallelize async operations and render HTML or Markdown with ovr.
---

## JSX

ovr has a built in JSX import source that can be used to parallelize component renders and output markup, such as HTML or XML, or Markdown.

Components are functions that return a `JSX.Element`. Each describes a part of the page, and can read the data that part shows, so a page is put together from parts that look after themselves. [Pages](/pages) covers what belongs in a route and what in a component.

Define a `props` object as a parameter for a component to pass arguments to it.

```tsx
import type { JSX } from "ovr";

function Component(props: { children?: JSX.Element; color: string }) {
	return <div style={`color: ${props.color}`}>{props.children}</div>;
}
```

Now the component can be used as its own tag within other components.

> Use capital letters for components to distinguish them from HTML (or _intrinsic_) elements.

```tsx
function Page() {
	return (
		<div>
			<h1>Hello world</h1>
			<Component color="blue">Children</Component>
		</div>
	);
}
```

Props are passed in like an HTML attribute `name={value}`, while `children` is a special prop that is used to reference the element(s) in between the opening and closing tags.

ovr aligns with the standard (all lowercase) HTML attributes---all attributes will be rendered exactly as they are written. Values are escaped. A name that would break the tag, such as a key from a user's object spread into props, is left out, as is a `javascript:` URL in `href`, `src`, `action`, `formaction`, `data`, or `xlink:href`, such as a website a user gave.

> If you're coming from React, this means you must use `class` and `for` instead of `className` and `htmlFor` respectively. There is also no need to provide a `key` attribute when rendering lists.

## Async components

Components can be asynchronous, so a component reads what it shows: give it an ID, and it queries for the data.

```tsx
async function Comments(props: { post: string }) {
	const comments = await database.sql`
		SELECT * FROM ${database.comments}
		WHERE ${database.comments.columns.post} = ${props.post}
	`.parse(database.comments);

	return (
		<ul>
			{comments.map((comment) => (
				<li>{comment.body}</li>
			))}
		</ul>
	);
}

<Comments post={post.id} />;
```

Anything that returns a promise works the same way, such as a `fetch` to another service.

## Context

A component's second argument is the [context](/middleware#context) of the request it is rendered for, so a page doesn't pass `c` down to the components that need it.

```tsx
import type { Context, JSX } from "ovr";

function NavLink(props: { href: string; children: JSX.Element }, c: Context) {
	const current = props.href === c.url.pathname;

	return (
		<a href={props.href} aria-current={current ? "page" : undefined}>
			{props.children}
		</a>
	);
}

<NavLink href="/posts">Posts</NavLink>;
```

It reads the request, with `req`, `ip`, `url`, `params`, `route`, `session()`, `memo()`, and `cookie.get()`. By the time a component runs the response has started, so a header, a cookie, or a redirect from one would be lost, and a component's `Context` has no way to make them: it is a type error. The route's own `c`, a [`Middleware.Context`](/middleware#context), is the one that answers.

To take a component as a value, such as a prop that is one, type it with `JSX.Component`. A component fits it whether or not it reads the context.

```tsx
import type { JSX } from "ovr";

function Card(props: { icon: JSX.Component<{ size: number }> }) {
	return <props.icon size={16} />;
}
```

## Shared reads

A component that reads its own data can be used more than once on a page, and each use would read again. `c.memo` shares a function's result for the rest of the request: called again with the same arguments, it returns what it returned the first time.

```tsx
const userOf = (id: string) =>
	database.sql`
		SELECT * FROM ${database.users}
		WHERE ${database.users.columns.id} = ${id}
	`.parse(database.users);

async function Byline(props: { user: string }, c: Context) {
	const [user] = await c.memo(userOf)(props.user);

	return <p>By {user?.name}</p>;
}

// one query, though the author is shown twice
<>
	<Byline user={post.author} />
	<article>{post.body}</article>
	<Byline user={post.author} />
</>;
```

Different components share the same way, when each calls `c.memo(userOf)`. So does the route through its own `c`, so what it reads to decide a redirect is not read again by the page. Nothing is kept for the next request.

Functions like `userOf` are the app's data layer: define each once, in a module of their own in a larger app, and call them from routes and components alike. See [Pages](/pages#data-functions).

Results are kept by the function and its arguments, compared as `===` does. Define the function once, outside of the component, and give it IDs and other plain values: a function or an object made for the call never matches an earlier one. A promise is shared as it is, so components that render at the same time wait for one read.

Call it with the same arguments everywhere, written out. `userOf(id)` and `userOf(id, null)` are two reads, even when the second parameter defaults to `null`.

## Generator components

Components can also be generator functions for more fine grained control and [memory optimization](/demo/memory). When utilizing generators `yield` values instead of returning them.

```tsx
async function* Generator() {
	yield <p>start</p>; // streamed immediately

	await promise; // async work

	yield <p>after</p>;
}
```

The [chat demo](/demo/chat) streams a model's reply this way, without client-side JavaScript.

## Parallelization

Components beside each other start at the same time, and their output is sent in the order it is written. Here `Username`, `Generator`, and `Data` all begin as soon as `Page` renders, [in parallel](/demo/parallel):

```tsx
function Page() {
	return (
		<main>
			<Username />
			<div>
				<Generator />
				<Data />
			</div>
		</main>
	);
}
```

This holds all the way down the tree. When a component returns, the components it returned start together, and so on at every level. A page waits as long as its slowest path from top to bottom, not the sum of its reads, so one read never waits for another unless one component is inside the other.

What a component awaits before it returns is the exception: anything it renders starts after that. So read in the component that shows the data, and keep a parent's own awaits to what its children need.

> The order of your components does not affect when they start, but it does affect when they are shown. If `Username` is the slowest, `Generator` and `Data` are ready and waiting, and are sent as soon as `Username` is. Nothing arrives out of order, so no client-side JavaScript has to put the page together.

## Data types

You can `return` or `yield` most data types from a component, they will be rendered as you might expect. Each of these data types can also be rendered [on its own](#render-an-element-yourself).

```tsx
function* DataTypes() {
	yield null; // ""
	yield undefined; // ""
	yield false; // ""
	yield true; // ""

	yield "string"; // "string"
	yield 0; // "0";
	yield <p>jsx</p>; // "<p>jsx</p>"
	yield ["any-", "iterable", 1, null]; // "any-iterable1"
	yield () => "function"; // "function"
	yield async () => "async"; // "async"
}
```

> Check out the [source code](https://github.com/ovrjs/ovr/blob/main/packages/ovr/src/markup/index.ts) for the renderer to understand how ovr evaluates each data type.

## Render an element yourself

A page is rendered for you when a route returns it. To render an element on its own, such as to write a file or build an email, use `new Render`. Give it the element as `markup`, for HTML and other markup such as SVG or an XML sitemap, or as `markdown`. Either is an async iterable, with a `stream()` and a `string()`.

### Iterate

Iterate the render for each chunk as the element renders.

```tsx
import { Render } from "ovr";

function Component() {
	return <p>element</p>;
}

const render = new Render({ markup: <Component /> });

for await (const chunk of render) {
	console.log(chunk); // <p>element</p>
}
```

Any of the supported [data types](#data-types) can be rendered without JSX. This array runs all of its async operations in parallel:

```ts
const render = new Render({
	markup: [
		async () => "hello",
		"world",
		[
			async function* () {
				yield "!";
			},
		],
	],
});

for await (const chunk of render) {
	console.log(chunk);
}
```

### Stream

Turn an element into a `ReadableStream` with `stream()`. It handles backpressure for slower clients, and stops rendering if the client aborts the request. Each read sends everything that is ready, up to about 2KB, and nothing waits for what is still loading.

```tsx
const stream = new Render({ markup: <Component /> }).stream();

const response = new Response(stream, {
	headers: { "content-type": "text/html; charset=utf-8" },
});
```

### String

`string()` renders the whole element and joins it into one string.

```tsx
const html = await new Render({ markup: <Component /> }).string();
```

### Options

| Option    | Value                                                                                   |
| --------- | --------------------------------------------------------------------------------------- |
| `context` | The request's context, which each component is given as its [second argument](#context) |
| `raw`     | `true` to skip escaping, for content that is not markup, such as plain text             |
| `base`    | For Markdown, what links resolve against. The request's URL when `context` is given     |

```tsx
// inside a request, so the components can read it
const html = await new Render({ markup: <Page /> }, { context: c }).string();
```

Without a `context`, a component that reads its second argument has none to read.

### Markdown output

`new Render({ markdown: element })` renders the same elements to Markdown. Pages already render as Markdown for [agents that ask for it](/agents#markdown); use it to render Markdown yourself.

```tsx
function Post() {
	return (
		<article>
			<h1>Hello</h1>
			<p>
				Read the <a href="/docs">docs</a>.
			</p>
		</article>
	);
}

const md = await new Render(
	{ markdown: <Post /> },
	{ base: "https://example.com" },
).string();
// # Hello
//
// Read the [docs](https://example.com/docs).
```

Text is escaped, so a page's content, such as a user's comment, cannot write Markdown of its own. Each block, such as a paragraph or a list, is written once it closes, so a stream still sends the page as it renders. When the element has a `<main>`, only its contents are written; without one a `<main>` could still follow, so the page is written when it ends. Scripts, styles, and hidden elements are left out, forms are described by their fields, and links resolve against `base`. Raw markup from `Render.raw` is written as it is, since Markdown can contain HTML. A form in a table's cell that is only a button is written in the cell, one with fields after the table, and an element that holds blocks, such as a custom element around a card, is read as a container.

## Raw

To render safe markup **without escaping**, use `Render.raw`. Text is escaped, so `&&` in an inline script would become `&amp;&amp;` and break it.

```tsx
import { Render } from "ovr";

function Theme() {
	return (
		<script>
			{Render.raw({
				markup: `if (matchMedia("(prefers-color-scheme: dark)").matches && !localStorage.theme) document.documentElement.dataset.theme = "dark";`,
			})}
		</script>
	);
}
```

Use it for markup you trust, such as HTML from a Markdown processor or an SVG file, never for user input.

Agents reading the page as [Markdown](#markdown-output) get the same markup, which Markdown can contain. Give `markdown` too, and they get that in its place: for content written in Markdown, such as a recipe's steps, the source it was rendered from. Neither is escaped.

| Call                                   | The page shows | Agents read  |
| -------------------------------------- | -------------- | ------------ |
| `Render.raw({ markup })`               | The markup     | The markup   |
| `Render.raw({ markup, markdown })`     | The markup     | The Markdown |
| `Render.raw({ markdown })`             | Nothing        | The Markdown |
| `Render.raw({ markup, markdown: "" })` | The markup     | Nothing      |

## Escape

`Render.raw` writes what it is given, so escape any text you put into it, as a render does for you everywhere else. Say where the text goes:

```tsx
Render.escape({ markup: "a < b" }); // "a &lt; b", an element's content
Render.escape({ attr: 'say "hi"' }); // "say &quot;hi&quot;", an attribute's value
Render.escape({ markdown: "2 * 3" }); // "2 \\* 3"

Render.raw({
	markup: `<b>${Render.escape({ markup: recipe.title })}</b>`,
	markdown: `**${Render.escape({ markdown: recipe.title })}**`,
});
```

Escaped Markdown reads as the text it was: its syntax characters are escaped, and so is what would start a block on a line, such as `#`, `>`, or `1.`.
