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

## JSON Schema

`toJsonSchema` describes a schema as a [JSON Schema](https://json-schema.org/) object, for example to document an API or define tool parameters.

```ts
user.toJsonSchema();
// {
// 	$schema: "https://json-schema.org/draft/2020-12/schema",
// 	type: "object",
// 	properties: {
// 		name: { type: "string", minLength: 2 },
// 		age: { type: "integer", minimum: 13 },
// 	},
// 	required: ["name", "age"],
// 	additionalProperties: false,
// }
```

- `target` selects `"draft-2020-12"` (default) or `"draft-07"`.
- `io` describes the parsed `"output"` (default) or the accepted `"input"`. They differ for `default`, `preprocess`, `pipe`, `json`, `transform`, and unknown keys removed from objects.
- Custom `refine` checks are omitted. BigInts, `instance` schemas such as `Field.file()`, and transform outputs throw a `TypeError`; set `unrepresentable: "any"` to describe them as `{}`.

Schemas also implement [Standard JSON Schema](https://standardschema.dev/json-schema) through `~standard.jsonSchema`, so libraries that accept it can convert them directly.

## POST forms

Use `Field` to describe the expected inputs for a POST route. `Context.data()` parses the [`multipart` request](/06-multipart) with the matching types.

```tsx
import { Field, Route } from "ovr";

export const signup = Route.post("/signup")
	.fields({ name: Field.text().min(2) })
	.use(async (c) => {
		const result = await c.data();

		if (result.issues) return c.redirect(result.url, 303);

		// create account...

		return <p>Welcome, {result.data.name}.</p>;
	});

export const page = Route.get("/signup").use((c) => (
	<signup.Form state={c.url} />
));
```

`signup.Form` renders the `<form>` _and_ the fields inside by default. The button is labelled "Submit"; pass `submit` to change it, for example `<signup.Form submit="Sign up" />`.

```html
<form
	action="/signup?_return=%2Fsignup"
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

> If you want to reuse the schema outside of a route, create it with `Form.from(shape)` and pass the resulting form to `route.fields(form)`.

### Edit a record

Pass `values` to fill the fields with a record's current values. Values restored from an invalid submission take precedence, and values a field can't render, such as dates and `null`, are skipped. `Fields`, `Field`, and `component` accept `values` too.

```tsx
const update = Route.post("/posts/:id").fields(fields).use(handler);

const edit = Route.get("/posts/:id/edit").use(async (c) => {
	const post = await find(c.params.id);

	return <update.Form params={{ id: post.id }} values={post} state={c.url} />;
});
```

### Errors after parsing

Some issues are only found after the data is valid, for example when a database constraint rejects a duplicate email. `result.invalid` puts messages on fields and returns an invalid result with the same `url` as a failed parse, keeping persisted values.

```tsx
const signup = Route.post("/signup")
	.fields({ email: Field.email().persist() })
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		const [user] = await database.sql`
		INSERT INTO ${database.users} ${database.sql.values(database.users, result.data)}
		ON CONFLICT (email) DO NOTHING RETURNING *
	`.parse(database.users);
		if (!user) {
			const invalid = result.invalid({ email: "Already registered" });
			return c.redirect(invalid.url, 303);
		}

		// ...
	});
```

## Input normalization

ovr also normalizes a few common HTML form quirks before validation:

- Single-value text-like inputs read blank values as missing during form parsing, so optional fields are omitted from the parsed output and `.default(...)` still applies like you would expect.
- `Field.number()` and `Field.range()` coerce submitted strings into numbers, while blank submissions still count as missing instead of becoming `0`. Integers beyond `Number.MAX_SAFE_INTEGER` fail validation instead of being rounded.
- `Field.checkbox()` reads presence as a boolean, so omitted checkboxes become `false`.
- `Field.file()` and `Field.files()` treat the browser's [empty placeholder file](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-form-data-set) as missing, while real zero-byte named files are still preserved.

## Persisted form state

ovr stores issue metadata and any values marked with `.persist()` in the `_form` search param so the next render can:

- persist user input for fields marked with `.persist()`
- render the matching issue message
- set `aria-invalid` and `aria-describedby`
- autofocus the first invalid field

Only opt in non-sensitive fields. Values marked with `.persist()` are encoded into the URL-backed state and may also appear in browser history, analytics, server logs, and similar tooling. `.persist()` returns a new field, so mark a [table's](/09-database) fields in each route that uses them, for example `.fields({ title: title.persist() })`, and each form decides.

## GET forms

`Route.get` can use the same schema helpers for GET forms that send the value as search params. `Context.data()` reads the `_form` to create a URL, or the current URL can also be used to persist the state.

```tsx
import { Field, Route } from "ovr";

export const search = Route.get("/search")
	.fields({
		q: Field.search({ label: "Search" }).optional(),
		minPrice: Field.number().min(0).optional(),
		inStock: Field.checkbox(),
	})
	.use(async (c) => {
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
	});
```

## Streaming

To stream uploads, mark a file field with `.stream()`. `Context.data()` will validate the non-streamed fields first, then expose the current and remaining multipart parts on `result.stream`.

```tsx
import { upload } from "./upload";
import { Field, Route } from "ovr";

const submit = Route.post("/submit")
	.fields({
		date: Field.date(),
		// place streamed fields last in the document so previous can be parsed
		// or adjust the order with client side js before submission
		license: Field.file().stream(),
	})
	.use(async (c) => {
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
	});
```

## Protections

- `Context.data()` automatically sets the multipart `parts` limit from the schema. Single inputs count as `1`, checkbox groups and multiselects count by their max cardinality, and `Field.files()` uses `Infinity`.
- You can still override the parser per request with `Context.data({ parts, memory, payload })`.
- App-wide multipart defaults can be set with `new App({ form: { memory, payload, parts } })`.
- Unexpected names in `FormData` or multipart requests become validation issues instead of being silently accepted.
