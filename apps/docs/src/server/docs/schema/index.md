---
title: Schema
description: Type-safe validation and form generation with ovr.
---

ovr's `Schema` API is modeled after [Zod](https://zod.dev/) and implements [Standard Schema](https://standardschema.dev/). Use it on its own to parse arbitrary values, or use `Field` to turn those validations into HTML forms.

## Parse

A schema's `parse` safely parses an `unknown` into a `Schema.Parse.Result`.

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

`toJsonSchema` describes a schema as a [JSON Schema](https://json-schema.org/) object, for example to document an API or define tool parameters. A schema's `describe(text)` is its `description` there.

```ts
user.toJsonSchema();
```

```json
{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"properties": {
		"name": { "type": "string", "minLength": 2 },
		"age": { "type": "integer", "minimum": 13 }
	},
	"required": ["name", "age"],
	"additionalProperties": false
}
```

- `target` selects `"draft-2020-12"` (default) or `"draft-07"`.
- `io` describes the parsed `"output"` (default) or the accepted `"input"`. They differ for `default`, `preprocess`, `pipe`, `json`, `transform`, and unknown keys removed from objects.
- Custom `refine` checks are omitted. BigInts, `instance` schemas such as `Field.file()`, and transform outputs throw a `TypeError`; set `unrepresentable: "any"` to describe them as `{}`.

Schemas also implement [Standard JSON Schema](https://standardschema.dev/json-schema) through `~standard.jsonSchema`, so libraries that accept it can convert them directly.

## POST forms

Use `Field` to describe the expected inputs for a POST route. `Context.data()` parses the [`multipart` request](/multipart) with the matching types, as it does for `PUT`, `PATCH`, and `DELETE` routes. Try it in the [form demo](/demo/form).

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
		<input id="name" required type="text" name="name" />
	</div>
	<button>Submit</button>
</form>
```

A control is `required` when leaving it empty fails validation, so browsers and screen readers know before submitting, and agents reading the page as Markdown see it too. Fields made `.optional()` or given a `.default()` are not required. A lone `Field.checkbox()` never is, since unchecked is `false`, and neither are the boxes of `Field.checkboxes()`, where `required` would mean every box. Pass `required={false}` to leave it to the server, or add `novalidate` to the form to show only the server's messages.

> Labels and legends default to the field `name`. Simple CSS such as `text-transform: capitalize` is often enough for the generated markup. Alternatively, give the field a label: `Field.text().label("Full Name")`.

`describe` says what a value is, as a route's [`describe`](/route#describe) says what the route does. Any schema takes it, such as one in a route's [`params`](/route#parameters), and a field also shows it to people: `Field.url().label("URL").describe("An http or https address")`. People read it in a paragraph under the control, `<p id="url-description" data-description>`, which the control names in `aria-describedby`. Both reach [agents](/agents#tools) too: the label is the field's `title` and the description its `description` in its [JSON Schema](#json-schema), which an agent reads before it calls the tool. Use the `Description` part from `signup.component` to place it yourself.

A description written to be complete for an agent can be more than a person needs under a control. `hint` is what people read in its place, and agents still read the description: `Field.number().describe("Weight in grams for cups and spoons. Empty for counts and liquids.").hint("For cups and spoons")`. An empty hint shows people nothing.

`control` gives the field's control its attributes wherever it renders: `Field.text().control({ placeholder: "Harry Potter" })`. Attributes for one form are passed when it renders, `<signup.Field name="name" autofocus />`.

- `signup.Fields` renders all the fields _without_ the outer `<form>` shell
- `signup.Field` renders one field by `name` (each key in the shape)
- `signup.component` exposes the low-level field components for more customization, for example if you need to change the position of the label or input.

---

The `state` prop for each component takes the current page `c.url`. The URL contains a same-origin `_return` query param on the action URL so invalid redirects can return to the page that rendered the form.

> To share fields between routes, reuse the shape object, such as `.fields({ ...shape, note: Field.textarea() })`.

Routes that share fields can share the component that lays them out. Give it the route, typed as either one, such as `route: typeof create | typeof update`, and render `<route.Field name="title" />` for the fields both have. Render each route's own `Form` around it, since one may need `params` the other does not take.

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
			ON CONFLICT (email) DO NOTHING
			RETURNING *
		`.parse(database.users);
		if (!user) {
			const invalid = result.invalid({ email: "Already registered" });
			return c.redirect(invalid.url, 303);
		}

		// ...
	});
```

### Choices

`Field.checkboxes()`, `Field.radio()`, and `Field.select()` take their options, and the value must be one of them:

```tsx
const recipe = Route.post("/recipes/:id")
	.fields({
		season: Field.radio(["fall", "winter"]),
		tags: Field.checkboxes(["easy", "crockpot"]),
	})
	.use(handler);
```

People see each option as its value. To call one something else, give the options as an object of each value and its label. The value is still what is sent, the route gets, and an agent sends, and the tool's description lists each value with its label:

```tsx
Field.select({ dinner: "Dinner", crockpot: "Slow cooker" });
```

When the options are only known as the page renders, such as which of a recipe's own photos to publish, give a schema that checks each value instead, and pass the options to the field as it renders: the values, or an object of each value and its label. A label given as the form renders may be an element, such as `{ [photo.id]: <img src={photo.url} alt={photo.caption} /> }`, which agents read by its `alt`. A label with its own text beside the image should give the image `alt=""`, or both are read. The schema only checks the form of a value, so check that each one is the user's own in the handler.

```tsx
const publish = Route.post("/recipes/:id/publish")
	.fields({ photos: Field.checkboxes(Schema.string().uuid()) })
	.use(handler);

<publish.Form params={{ id }}>
	<publish.Field name="photos" options={photos.map((photo) => photo.id)} />
	<button>Publish</button>
</publish.Form>;
```

Agents see these as an array of the schema's values, such as UUIDs, without a fixed list.

> An object lists keys that are whole numbers first, in number order, whatever order they were written in. Options whose values are numeric IDs are shown in that order.

A select that may be left empty, one made `.optional()`, starts with an empty choice, since a browser otherwise chooses its first option. `placeholder` is that choice's text: `Field.select(meals).optional().control({ placeholder: "Any meal" })`. A select that must be chosen starts with the choice too when it has a `placeholder`, such as "Choose a meal", and the browser asks for another. Write the choice yourself in a layout made with `component`.

### Lists

`Field.textarea().lines()` is a list of text, such as a recipe's steps or tags. People write one on each line of a textarea, [agents](/agents#tools) send an array, and the route gets a `string[]` either way. Empty lines are left out, and each line is checked as the textarea checks its text, so `Field.textarea().max(80).lines()` limits each line to 80 characters. What comes after counts the lines: `Field.textarea().lines().max(10)` takes at most ten.

`Field.list()` is a list of items in order, where an item may repeat. Each item is one field, or several by name:

```tsx
const save = Route.post("/recipes/:id")
	.fields({
		steps: Field.textarea().lines(),
		ingredients: Field.list({
			amount: Field.number().optional(),
			name: Field.text(),
		}),
		// choices known as the page renders, in the order they are chosen
		sides: Field.list(Field.select(Schema.string().uuid())).optional(),
	})
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		result.data.steps; // ["Chop", "Fry"]
		result.data.ingredients; // [{ amount: 2, name: "onion" }, { name: "salt" }]
		result.data.sides; // ["0b8f…", "1c9e…"] | undefined
	});
```

A list renders a `<fieldset>` with a row for each item, and one empty row to add another. A list of several fields is a `<table>` in it, with a column for each field: its label is the column's heading, each cell has the control and its issue, and the fields' descriptions are listed once under the table. The table is in a `<div>` of its own, so a wide one can scroll sideways alone, such as `.wide > div { overflow-x: auto }`. A list's own description follows its legend, before the rows it explains, as a radio or checkbox group's does. Attributes passed to a list, such as `<save.Field name="ingredients" class="wide" />`, are its fieldset's, since it has no control of its own, as a group's are too: each box has what `control()` set. People clear a row to remove its item: a row left empty is left out, so nothing in a row is `required` in the browser, and the server checks each item that is filled. A list needs one item unless it is made `.optional()`, and `min()` and `max()` count its items, as they do for any array, such as `Field.checkboxes(tags).max(3)`.

Set how many rows a list shows with `control`, wherever it renders, or pass `rows` to one form, as with any field's attributes. A week's seven dinners are `Field.list(Field.select(id)).max(7).control({ rows: 7 })`, and an edit form with room to add is `<save.Field name="ingredients" rows={ingredients.length + 5} />`. Every item is always shown, and a list never shows more rows than its `max()`, so a full list has no empty row.

Each control is named by its list and its place, `sides.0` or `ingredients.0.amount`, so every row's controls have their own `id` and an issue is shown on the cell it is about. `values` takes the items as an array, as the route gets them.

Mark a list [`.persist()`](#persisted-form-state) so an invalid submission shows its rows again, with each issue on its cell. Without it the rows that were sent are gone, as any field's value is, so the issue is shown under the list and says where it was, such as "Row 2, Ingredient: Required field", with the field's label. The same happens when the rows are too many to keep in the URL.

A list's `options` are those of each row's choices made from a schema, so a week's dinners show each recipe's title with no layout of their own:

```tsx
<save.Field
	name="sides"
	options={Object.fromEntries(recipes.map((r) => [r.id, r.title]))}
/>
```

`save.component({ name: "ingredients" })` gives `Root`, `Legend`, `Description`, `Issue`, and `rows`, to lay a list out yourself. Each row is its field's component, or its fields' components by name. A row's control is read with its `Issue`, and not with its `Description`, which a layout says once rather than in every row:

```tsx
const Items = save.component({ name: "ingredients", values, state: c.url });

<Items.Root>
	<Items.Legend />
	{Items.rows.map((row) => (
		<p>
			<row.amount.Control aria-label="Amount" />
			<row.name.Control aria-label="Name" />
			<row.name.Issue />
		</p>
	))}
	<Items.Issue />
</Items.Root>;
```

A list has no script, so a person has the rows the page rendered, and saves to get more. To add a row in place, copy the last one: a row's controls are named by its place, and a place left out between two rows is fine. Give the list an `id` and render a button after it, hidden until the script runs:

```html
<button type="button" id="add" hidden>Add a row</button>

<script type="module">
	const name = "ingredients"; // the list's name, and here its id
	const list = document.getElementById(name);
	const add = document.getElementById("add");

	add.hidden = false;
	add.addEventListener("click", () => {
		const rows = list.querySelectorAll("tbody > tr");
		const last = rows[rows.length - 1];
		const row = last.cloneNode(true);

		// ingredients.3.name is ingredients.4.name in the next row
		row.innerHTML = row.innerHTML.replaceAll(
			`${name}.${rows.length - 1}`,
			`${name}.${rows.length}`,
		);

		for (const control of row.querySelectorAll("input, select, textarea")) {
			if (control.type === "checkbox" || control.type === "radio")
				control.checked = false;
			else control.value = "";
			control.removeAttribute("aria-invalid");
		}
		for (const issue of row.querySelectorAll("[data-issue]")) issue.remove();

		last.after(row);
		row.querySelector("input, select, textarea")?.focus();
	});
</script>
```

A list of one field has a `<div>` for each row in place of a `<tr>`, `:scope > div`, and each row's label is its number. To write the script in JSX, keep its text in a string and render it with `<script type="module">{Markup.raw(text)}</script>`, so its quotes and angle brackets are not escaped.

A list takes any field but another list or a [streamed](#streaming) file. `multiple()` is a different thing: one control that takes several of its own options or files, not rows.

## Input normalization

ovr also normalizes a few common HTML form quirks before validation:

- Single-value text-like inputs read blank values as missing during form parsing, so optional fields are omitted from the parsed output and `.default(...)` still applies like you would expect.
- `Field.number()` and `Field.range()` coerce submitted strings into numbers, while blank submissions still count as missing instead of becoming `0`. Text that is not a number, which only something other than a browser sends, is answered with "Enter a number". Integers beyond `Number.MAX_SAFE_INTEGER` fail validation instead of being rounded.
- `Field.checkbox()` reads presence as a boolean, so omitted checkboxes become `false`.
- `Field.file()` and `Field.file().multiple()` treat the browser's [empty placeholder file](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-form-data-set) as missing, while real zero-byte named files are still preserved.

## Persisted form state

ovr stores issue metadata and any values marked with `.persist()` in the `_form` search param so the next render can:

- persist user input for fields marked with `.persist()`
- render the matching issue message
- set `aria-invalid` and `aria-describedby`
- autofocus the first invalid field

The state is kept small, since it is in a URL: a value over 512 characters is not kept, where each of many values, such as a line of `lines()`, has that limit of its own and a list's items have none, and the whole state is at most 4 KB before it is encoded. When it is larger, values are left out, from the form's last field back, until it fits. The issues are always kept, so the person sees what was wrong, but not what they typed in the fields left out. Keep a long form's values another way, such as by saving a draft.

Only opt in non-sensitive fields. Values marked with `.persist()` are encoded into the URL-backed state and may also appear in browser history, analytics, server logs, and similar tooling. `.persist()` returns a new field, so mark a [table's](/database) fields in each route that uses them, for example `.fields({ title: title.persist() })`, and each form decides.

## GET forms

`Route.get` can use the same schema helpers for GET forms that send the value as search params. `Context.data()` reads the `_form` to create a URL, or the current URL can also be used to persist the state. Only a GET route's form reads its fields from search params, since that is where it submits them. Other forms restore just what they [persisted](#persisted-form-state), so a link cannot fill in an edit form.

```tsx
import { Field, Route } from "ovr";

export const search = Route.get("/search")
	.fields({
		q: Field.search().label("Search").optional(),
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

- `Context.data()` automatically sets the multipart `parts` limit from the schema. Single inputs count as `1`, checkbox groups and a select with `multiple()` count by their number of options, and a file with `multiple()`, a group made from a schema, `Field.textarea().lines()`, or `Field.list()` has no limit.
- You can still override the parser per request with `Context.data({ parts, memory, payload })`.
- A body over a limit, such as more parts than the form has fields, throws a `Multipart.Limit`, one that is not multipart form data a `Multipart.Unsupported`, and malformed form data a `Multipart.Malformed`. Browsers submitting your form never send any of these. Left uncaught by the route, ovr answers them itself: 413 for a body over a limit, 415 for another content type, and 400 for malformed form data. Catch them in the route's own [middleware](/middleware) to answer differently; global middleware that [catches errors](/middleware#not-found-and-errors) sees the answer, not the error.
- App-wide multipart defaults can be set with `new App({ multipart: { memory, payload, parts } })`.
- Unexpected names in `FormData` or multipart requests become validation issues instead of being silently accepted. A list takes only the names of its own cells, such as `ingredients.0.amount`.
