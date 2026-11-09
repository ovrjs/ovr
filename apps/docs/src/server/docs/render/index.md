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

You can `return` or `yield` most data types from a component, they will be rendered as you might expect. Each of these data types can also be rendered on its own, with [`Markup`](#markup) or [`Markdown`](#markdown).

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

> Check out the [source code](https://github.com/ovrjs/ovr/blob/main/packages/ovr/src/markup/index.ts) for the `Markup` class to understand how ovr evaluates each data type.

## Markup

To render any element on its own (for example, if you aren't returning it from `Middleware` or need to call it separately), use the `Markup` class. It renders HTML, and other markup such as SVG or an XML sitemap.

### Async iterable

Create a new `Markup` async iterable that yields escaped `Chunk`s of markup.

```tsx
import { Markup } from "ovr";

function Component() {
	return <p>element</p>;
}

const markup = new Markup(<Component />);

for await (const chunk of markup) {
	console.log(chunk.toString()); // markup string
}
```

> Any of the supported [data types](#data-types) can also be rendered directly without JSX. For example, the following array can be passed into `Markup` running all async operations in parallel.

```ts
const markup = new Markup([
	async () => "hello",
	"world",
	[
		async function* () {
			yield "!";
		},
	],
]);

for await (const chunk of markup) {
	console.log(chunk.toString());
}
```

Set `Markup.Options.raw` to `true` to skip escaping, for content that is not markup, such as plain text or server-sent events.

```ts
new Markup(element, { raw: true });
```

### Stream

Turn an element into a `ReadableStream` using `Markup.stream`.

This stream is optimized for generating markup---it ensures backpressure is properly handled for slower clients and generation stops if the client aborts the request.

```tsx
import { Markup } from "ovr";

function Component() {
	return <p>element</p>;
}

const stream = Markup.stream(<Component />);

const response = new Response(stream, {
	headers: { "content-type": "text/html; charset=utf-8" },
});
```

### String

Convert any element into a `string` of markup with `Markup.string`. This iterates through the render and joins the results into a single string.

```tsx
import { Markup } from "ovr";

function Component() {
	return <p>element</p>;
}

const str = await Markup.string(<Component />);
```

### Raw markup

To render safe markup **without escaping**, use `Markup.raw`. Text is escaped, so `&&` in an inline script would become `&amp;&amp;` and break it.

```tsx
import { Markup } from "ovr";

function Theme() {
	return (
		<script>
			{Markup.raw(
				`if (matchMedia("(prefers-color-scheme: dark)").matches && !localStorage.theme) document.documentElement.dataset.theme = "dark";`,
			)}
		</script>
	);
}
```

Use it for markup you trust, such as HTML from a Markdown processor or an SVG file, never for user input.

## Markdown

`Markdown` renders the same elements to Markdown, with the same ways in: an async iterable, a stream, and a string. Pages already render as Markdown for [agents that ask for it](/agents#markdown), use `Markdown` to render it yourself, such as to write files or answer with part of a page.

```tsx
import { Markdown } from "ovr";

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

const md = await Markdown.string(<Post />, { base: "https://example.com" });
// # Hello
//
// Read the [docs](https://example.com/docs).
```

Each block, such as a paragraph or a list, is written once it closes, so a stream still sends the page as it renders. When the element has a `<main>`, only its contents are written. Scripts, styles, and hidden elements are left out, forms are described by their fields, and links resolve against `base`. Raw markup from `Markup.raw` is written as it is, since Markdown can contain HTML.
