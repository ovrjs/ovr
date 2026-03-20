---
title: Schema
description: Type-safe validation and form generation with ovr.
---

ovr's `Schema` API is modeled after [Zod](https://zod.dev/) and implements [Standard Schema](https://standardschema.dev/). Use it on its own to parse arbitrary values, or use `Field` and `Form` to turn those validations into HTML forms.

## Parse

`Schema.parse` safely parses an `unknown` into a `Schema.Parse.Result`.

```ts
import { Schema } from "ovr";

const user = Schema.object({
	name: Schema.string().min(2),
	age: Schema.number().int().min(13),
});

// create a type based on the schema
type User = Schema.Infer<typeof user>;

const result = user.parse({ name: "Frodo", age: 33 });

if (result.issues) {
	result.issues; // [Schema.Issue, ...Schema.Issue[]] ([Error, ...Error[]])
	throw result; // Schema.AggregateIssue (AggregateError)
} else {
	result.data; // User
}
```

- When **invalid**, the result is a `Schema.AggregateIssue` containing a non-empty `issues` tuple.
- When **valid**, the result contains the type-safe `data`.

## POST forms

Use `Field` to describe the expected inputs for a POST route. `Context.data()` parses the [`multipart` request](/06-multipart) with the matching types.

```tsx
import { Field, Route } from "ovr";

export const signup = Route.post({ name: Field.text().min(2) }, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	// create account...

	return <p>Welcome, {result.data.name}.</p>;
});

export const page = Route.get("/signup", (c) => <signup.Form state={c.url} />);
```

`signup.Form` renders the `<form>` _and_ the fields inside by default.

```html
<form
	action="/_p/generated-hash?_return=%2Fsignup"
	method="POST"
	enctype="multipart/form-data"
>
	<div>
		<label for="name">name</label>
		<input id="name" type="text" name="name" />
	</div>
	<button>Submit</button>
</form>
```

> Labels and legends default to the field `name`. Simple CSS such as `text-transform: capitalize` is often enough for the generated markup. Alternatively, a `label` prop can be passed into the field during creation for a custom label: `Field.text({ label: "Full Name" })`.

- `signup.Fields` renders all the fields _without_ the outer `<form>` shell
- `signup.Field` renders one field by `name` (each key in the shape)
- `signup.component` exposes the low-level field components for more customization, for example if you need to change the position of the label or input.

---

The `state` prop for each component takes the current page `c.url`. The URL contains a same-origin `_return` query param on the action URL so invalid redirects can return to the page that rendered the form.

> If you want to reuse the schema outside of a route, create it with `Form.from(shape)` and pass the resulting form into `Route.get` or `Route.post`.

## Input normalization

ovr also normalizes a few common HTML form quirks before validation:

- Single-value text-like inputs read blank values as missing during form parsing, so optional fields are omitted from the parsed output and `.default(...)` still applies like you would expect.
- `Field.number()` and `Field.range()` coerce submitted strings into numbers, while blank submissions still count as missing instead of becoming `0`.
- `Field.checkbox()` reads presence as a boolean, so omitted checkboxes become `false`.
- `Field.file()` and `Field.files()` treat the browser's [empty placeholder file](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-form-data-set) as missing, while real zero-byte named files are still preserved.

## Persisted form state

ovr stores issue metadata and any values marked with `.persist()` in the `_form` search param so the next render can:

- persist user input for fields marked with `.persist()`
- render the matching issue message
- set `aria-invalid` and `aria-describedby`
- autofocus the first invalid field

Only opt in non-sensitive fields. Values marked with `.persist()` are encoded into the URL-backed state and may also appear in browser history, analytics, server logs, and similar tooling.

## GET forms

`Route.get` can use the same schema helpers for GET forms that send the value as search params. `Context.data()` reads the `_form` to create a URL, or the current URL can also be used to persist the state.

```tsx
import { Field, Route } from "ovr";

export const search = Route.get(
	"/search",
	{
		q: Field.search({ label: "Search" }).optional(),
		minPrice: Field.number().min(0).optional(),
		inStock: Field.checkbox(),
	},
	async (c) => {
		const result = await c.data();

		if (result.issues) return <search.Form state={result.url} />;

		result.data; // { q: "travel backpack", minPrice: 50, inStock: true }

		// fetch results...

		return (
			<>
				<search.Form
					state={
						c.url // /search?q=travel+backpack&minPrice=50&inStock=on
					}
				/>
				<h2>Results for {result.data.q || "all products"}</h2>
			</>
		);
	},
);
```

## Streaming

To stream uploads, mark a file field with `.stream()`. `Context.data()` will validate the non-streamed fields first, then expose the current and remaining multipart parts on `result.stream`.

```tsx
import { upload } from "./upload";
import { Field, Route } from "ovr";

const submit = Route.post(
	{
		date: Field.date(),
		// place streamed fields last in the document so previous can be parsed
		// or adjust the order with client side js before submission
		license: Field.file().stream(),
	},
	async (c) => {
		const result = await c.data();

		if (result.issues) return c.redirect(result.url, 303);

		const { date } = result.data; // non-streamed date field

		if (result.stream) {
			for await (const part of result.stream) {
				if (part.name === "license") {
					// stream the upload
					await upload(part.body, date);
				}
			}
		}

		c.redirect("/files", 303);
	},
);
```

## Protections

- `Context.data()` automatically sets the multipart `parts` limit from the schema. Single inputs count as `1`, checkbox groups and multiselects count by their max cardinality, and `Field.files()` uses `Infinity`.
- You can still override the parser per request with `Context.data({ parts, memory, payload })`.
- App-wide multipart defaults can be set with `new App({ form: { memory, payload, parts } })`.
- Unexpected names in `FormData` or multipart requests become validation issues instead of being silently accepted.
