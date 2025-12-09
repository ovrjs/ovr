---
title: Rendering
description: Easily parallelize async operations and render strings with ovr.
---

## JSX

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

You can `return` or `yield` most data types from a component, they will be rendered as you might expect. Each of these data types can also be used to create a new [`Render`](#render).

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

> Check out the [source code](https://github.com/rossrobino/ovr/blob/main/packages/ovr/src/render/index.ts) for the `render` function to understand how ovr evaluates each data type.

## Render

To render any element on it's own (for example, if you aren't using returning them from `Middleware` or need to call them separately), use the `Render` class.

### Async iterable

Create a new `Render` async iterable that yields escaped `Chunk`s of HTML.

```tsx
import { Render } from "ovr";

function Component() {
	return <p>element</p>;
}

const render = new Render(<Component />);

for await (const chunk of render) {
	console.log(chunk.value); // value contains the HTML string
}
```

> Set `Render.Options.safe` to `true` to bypass HTML escaping to render other types of content: `new Render(element, { safe: true })`.

### Stream

Turn an element into a `ReadableStream` using `Render.stream`. This pipes a `Render` into a `ReadableStream`.

This stream is optimized for generating HTML---it ensures backpressure is properly handled for slower clients and generation stops if the client aborts the request.

```tsx
import { Render } from "ovr";

function Component() {
	return <p>element</p>;
}

const stream = Render.stream(<Component />);

const response = new Response(stream, {
	"content-type": "text/html; charset=utf-8",
});
```

### String

Convert any element into a `string` of HTML with `Render.string`. This iterates through the `Render` and joins the results into a single string.

```tsx
import { Render } from "ovr";

function Component() {
	return <p>element</p>;
}

const str = await Render.string(<Component />);
```

### Raw HTML

To render safe HTML **without escaping**, use the `Render.html` method.

```tsx
import { Render } from "ovr";

const html = "<p>Safe to render</p>";

function Component() {
	return <div>{Render.html(html)}</div>;
}
```
