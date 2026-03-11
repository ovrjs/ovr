---
title: Schema
description: Type-safe validation and form generation with ovr.
---

## Overview

ovr's `Schema` API is modeled after [Zod](https://zod.dev/) and implements [Standard Schema](https://standardschema.dev/). Use it on its own to parse arbitrary values, or use `Field` and `Form` to turn those validations into HTML forms.

- **Form generation** - `Route.post(schema, ...)` creates `Form`, `Fields`, and `Field` helpers from the schema.
- **Typed parsing** - `c.data()` parses search params or multipart form data and returns typed `data`.
- **Server-driven validation** - Invalid submissions return a `url` you can redirect to and re-render with `state={c.url}`.
- **Streaming uploads** - Mark file fields with `.stream()` to validate fields first and then stream the remaining multipart parts.
- **Built-in guards** - Schema forms automatically derive a multipart `parts` limit and still use all [multipart protections](/06-multipart#options).

## Parse

Use `Schema` on its own any time you need to validate an unknown input.

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
	throw result.issues; // `result.issues` is an instance of `AggregateError`
} else {
	result.data; // User
}
```

## POST forms

Use `Field` to describe the expected inputs and pass the shape directly into `Route.post`. The route keeps the generated helpers from [`Route.post`](/04-route#post) and adds schema-specific `Fields`, `Field`, and `component(...)` helpers, while `c.data()` parses the [`multipart` request](/06-multipart) with the matching types.

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

This adds a few helpers to the route:

- `signup.Form` renders the `<form>` shell and default fields
- `signup.Fields` renders every field in the schema
- `signup.Field` renders one field by `name`
- `signup.component(...)` exposes the low-level field pieces

The default markup from `<signup.Form state={c.url} />` looks like this:

```html
<form action="/_p/generated-hash" method="POST" enctype="multipart/form-data">
	<div>
		<label for="name">name</label>
		<input id="name" type="text" name="name" />
	</div>

	<button>Submit</button>
</form>
```

> If you want to reuse the schema outside a route, create it up front with `Form.from(shape)` and pass the resulting form into `Route.get` or `Route.post`.

On an invalid submission, the round trip looks like this:

1. `c.data()` validates the current request.
2. If validation fails, redirect to `result.url`, which contains the encoded `_form` state in a search param.
3. Render the next request with `state={c.url}`.

ovr stores sanitized values and issue metadata in the `_form` search param so the next render can:

- persist user input for supported fields
- render the matching issue message
- set `aria-invalid` and `aria-describedby`
- autofocus the first invalid field

Password and file inputs are never persisted in the encoded state, but because invalid state is stored in the URL, persisted inputs may also appear in browser history, analytics, server logs, and similar tooling. Avoid putting sensitive user input in URL-backed state.

> Labels and legends default to the field `name`. Simple CSS such as `text-transform: capitalize` is often enough for the generated markup.

## GET forms

`Route.get` can use the same schema helpers for forms that submit into the URL. The API is the same, but `c.data()` reads from `URLSearchParams` instead of the request body.

```tsx
import { Field, Route } from "ovr";

export const search = Route.get(
	"/search",
	{
		q: Field.search({ placeholder: "travel backpack" }).optional(),
		sort: Field.select(["relevance", "price", "newest"]).default("relevance"),
		inStock: Field.checkbox(),
	},
	async (c) => {
		const result = await c.data();

		if (result.issues) return c.redirect(result.url, 303);

		c.url; // /search?q=travel+backpack&sort=newest&inStock=on
		result.data; // { q: "travel backpack", sort: "newest", inStock: true }

		// fetch results...

		return (
			<>
				<search.Form state={c.url} />

				<h2>Results for {result.data.q || "all products"}</h2>
			</>
		);
	},
);
```

For `Route.get`, both the query and invalid `_form` state live directly in the URL, so the search can be linked, refreshed, or revisited without losing state, while `c.data()` parses values such as `inStock=on` into the expected types.

## Streaming

To stream uploads, mark a file field with `.stream()`. `c.data()` will validate the non-streamed fields first, then expose the current and remaining multipart parts on `result.stream`.

```tsx
import { upload } from "./upload";
import { Field, Route } from "ovr";

const submit = Route.post(
	{
		date: Field.date(),
		license: Field.file().stream(), // place streamed fields last so previous can be parsed
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

- `c.data()` automatically sets the multipart `parts` limit from the schema. Single inputs count as `1`, checkbox groups and multiselects count by their max cardinality, and `Field.files()` uses `Infinity`.
- You can still override the parser per request with `c.data({ parts, memory, payload })`.
- App-wide multipart defaults can be set with `new App({ form: { memory, payload, parts } })`.
- Unexpected names in `FormData` or multipart requests become validation issues instead of being silently accepted.
- Encoded `_form` state is capped at `4kb`, and each persisted value is capped at `512` serialized characters.

## Example

See the complete [schema demo](/demo/schema) for a larger form using text inputs, selects, radios, checkboxes, defaults, redirect state, and a streamed file upload.
