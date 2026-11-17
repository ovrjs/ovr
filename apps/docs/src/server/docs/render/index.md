---
title: Render
description: Easily parallelize async operations and render HTML or Markdown with ovr.
---

## JSX

ovr has a built in JSX import source that can be used to parallelize component renders and output [markup](#markup), such as HTML or XML, or [Markdown](#markdown). You can also render elements on their own without using JSX.

Components are functions that return a `JSX.Element`. Use them to declaratively describe and reuse parts of your HTML.

Define a `props` object as a parameter for a component to pass arguments to it.

```tsx
import type { JSX } from "ovr";

function Component(props: { children?: JSX.Element; color: string }) {
	return <div style={`color: ${props.color}`}>{props.children}</div>;
}
```

Now the component can be used as it's own tag within other components.

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

ovr aligns with the standard (all lowercase) HTML attributes---all attributes will be rendered exactly as they are written.

> If you're coming from React, this means you must use `class` and `for` instead of `className` and `htmlFor` respectively. There is also no need to provide a `key` attribute in when rendering lists.

## Async components

Components can be asynchronous, for example you can `fetch` directly in a component.

```tsx
async function Data() {
	const res = await fetch("...");
	const data = await res.text();

	return <div>{data}</div>;
}
```

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

<NavLink href="/recipes">Recipes</NavLink>;
```

By the time a component runs the response has started, so a header, a cookie, or a redirect from one would be lost. A component's `Context` has no way to make them, which makes it a type error: it reads the request, with `req`, `ip`, `url`, `params`, `route`, `session()`, `memo()`, and `cookie.get()`. The route's own `c`, a [`Middleware.Context`](/middleware#context), is the one that answers. A [render made on its own](#markup) gives its components the `context` it is given, and without one it has none to give.

```tsx
const html = await new Render({ markup: <Page /> }, { context: c }).string();
```

To take a component as a value, such as a prop that is one, type it with `JSX.Component`. A component fits it whether or not it reads the context.

```tsx
import type { JSX } from "ovr";

function Card(props: { icon: JSX.Component<{ size: number }> }) {
	return <props.icon size={16} />;
}
```

## Shared reads

Components that fetch what they show can be put anywhere on a page, but two of them that need the same rows would each query for them. `c.memo` shares a function's result for the rest of the request: called again with the same arguments, it returns what it returned the first time.

```tsx
const friendsOf = (user: string) =>
	database.sql`
		SELECT * FROM ${database.friends}
		WHERE ${database.friends.columns.user} = ${user}
	`.parse(database.friends);

async function Share(props: { user: string }, c: Context) {
	const friends = await c.memo(friendsOf)(props.user); // queries
	// ...
}

async function Offer(props: { user: string }, c: Context) {
	const friends = await c.memo(friendsOf)(props.user); // the same rows, no query
	// ...
}
```

The route shares the same results through its own `c`, so what it reads to decide a redirect is not read again by the page. Nothing is kept for the next request.

Results are kept by the function and its arguments, compared as `===` does. Define the function once, outside of the component, and give it IDs and other plain values: a function or an object made for the call never matches an earlier one. A promise is shared as it is, so components that render at the same time wait for one query.

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

These three components await in [parallel](/demo/parallel) when this component is evaluated. Then they will stream in order as soon as they are ready.

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

> The order of your components does not affect when they are evaluated, but it does impact when they will display. If `Username` is the slowest component, `Generator` and `Data` will be queued but only streamed after `Username` completes. This ensures no client-side JavaScript has to run for users to see your content.

## Data types

You can `return` or `yield` most data types from a component, they will be rendered as you might expect. Each of these data types can also be rendered on its own, as [markup](#markup) or [Markdown](#markdown).

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

## Markup

To render any element on its own (for example, if you aren't returning it from `Middleware` or need to call it separately), use `new Render({ markup: element })`. It renders HTML, and other markup such as SVG or an XML sitemap. A render is an async iterable, with a `stream()` and a `string()`.

### Async iterable

Iterate the render for strings of markup as the element renders.

```tsx
import { Render } from "ovr";

function Component() {
	return <p>element</p>;
}

const markup = new Render({ markup: <Component /> });

for await (const html of markup) {
	console.log(html); // <p>element</p>
}
```

> Any of the supported [data types](#data-types) can also be rendered directly without JSX. For example, the following array can be rendered, running all async operations in parallel.

```ts
const markup = new Render({
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

for await (const html of markup) {
	console.log(html);
}
```

Set the `raw` option to `true` to skip escaping, for content that is not markup, such as plain text or server-sent events.

```ts
new Render({ markup: element }, { raw: true });
```

### Stream

Turn an element into a `ReadableStream` with `stream()`.

This stream is optimized for generating markup---it ensures backpressure is properly handled for slower clients and generation stops if the client aborts the request. Each read sends everything that is ready, up to about 2KB, and nothing waits for what is still loading.

```tsx
import { Render } from "ovr";

function Component() {
	return <p>element</p>;
}

const stream = new Render({ markup: <Component /> }).stream();

const response = new Response(stream, {
	headers: { "content-type": "text/html; charset=utf-8" },
});
```

### String

Convert any element into a `string` of markup with `string()`. This iterates through the render and joins the results into a single string.

```tsx
import { Render } from "ovr";

function Component() {
	return <p>element</p>;
}

const str = await new Render({ markup: <Component /> }).string();
```

### Raw

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

Agents reading the page as [Markdown](#markdown) get the same markup, which Markdown can contain. Give `markdown` too, and they get that in its place: for content written in Markdown, such as a recipe's steps, the source it was rendered from. Neither is escaped.

| Call                                   | The page shows | Agents read  |
| -------------------------------------- | -------------- | ------------ |
| `Render.raw({ markup })`               | The markup     | The markup   |
| `Render.raw({ markup, markdown })`     | The markup     | The Markdown |
| `Render.raw({ markdown })`             | Nothing        | The Markdown |
| `Render.raw({ markup, markdown: "" })` | The markup     | Nothing      |

### Escape

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

## Markdown

`new Render({ markdown: element })` renders the same elements to Markdown, with the same ways out: an async iterable, a stream, and a string. Text is escaped, so a page's content, such as a user's comment, cannot write Markdown of its own. Pages already render as Markdown for [agents that ask for it](/agents#markdown), use it to render Markdown yourself, such as to write files or answer with part of a page.

```tsx
import { Render } from "ovr";

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

Each block, such as a paragraph or a list, is written once it closes, so a stream still sends the page as it renders. When the element has a `<main>`, only its contents are written; without one a `<main>` could still follow, so the page is written when it ends. Scripts, styles, and hidden elements are left out, forms are described by their fields, and links resolve against `base`, which is the request's URL when the render is given a `context`. Raw markup from `Render.raw` is written as it is, since Markdown can contain HTML. A form in a table's cell that is only a button is written in the cell, one with fields after the table, and an element that holds blocks, such as a custom element around a card, is read as a container.
