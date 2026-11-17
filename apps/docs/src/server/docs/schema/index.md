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

export const page = Route.get("/signup").use(() => <signup.Form />);
```

The route's `Form` renders the `<form>` _and_ the fields inside by default, and shows what a [refused submission](#a-refused-submission) sent. The button is labelled "Submit"; pass `submit` to change it, for example `<signup.Form submit="Sign up" />`.

```html
<form action="/signup" method="POST" enctype="multipart/form-data">
	<div>
		<label for="name">name</label>
		<input id="name" required type="text" name="name" />
	</div>
	<button>Submit</button>
</form>
```

A control is `required` when leaving it empty fails validation, so browsers and screen readers know before submitting, and agents reading the page as Markdown see it too. Fields made `.optional()` or given a `.default()` are not required. A lone `Field.checkbox()` never is, since unchecked is `false`, and neither are the boxes of `Field.checkboxes()`, where `required` would mean every box. Pass `required={false}` to leave it to the server, or add `novalidate` to the form to show only the server's messages.

> Labels and legends default to the field `name`. Simple CSS such as `text-transform: capitalize` is often enough for the generated markup. Alternatively, give the field a label: `Field.text().label("Full Name")`.

`describe` says what a value is, as a route's [`describe`](/route#describe) says what the route does. Any schema takes it, such as one in a route's [`params`](/route#parameters), and a field also shows it to people: `Field.url().label("URL").describe("An http or https address")`. People read it in a paragraph under the control, `<p id="url-description" data-description>`, which the control names in `aria-describedby`. Both reach [agents](/agents#tools) too: the label is the field's `title` and the description its `description` in its [JSON Schema](#json-schema), which an agent reads before it calls the tool. Use the `Description` part from [`join.component`](#lay-out-the-fields) to place it yourself.

A description written to be complete for an agent can be more than a person needs under a control. `hint` is what people read in its place, and agents still read the description: `Field.number().describe("Weight in grams for cups and spoons. Empty for counts and liquids.").hint("For cups and spoons")`. An empty hint shows people nothing.

`control` gives the field's control its attributes wherever it renders: `Field.text().control({ placeholder: "Harry Potter" })`. Attributes for one form are passed when it renders, `<form.Field name="name" autofocus />`.

The form returns a refused submission to the page it is on. On a page with another address than the form's own, its action carries the page's address in a same-origin `_return` query param, such as `action="/signup?_return=%2Fjoin"`.

> To share fields between routes, reuse the shape object, such as `.fields({ ...shape, note: Field.textarea() })`.

### Lay out the fields

Give the `Form` a function to lay the fields out yourself. It is given the form's parts:

```tsx
<signup.Form>
	{(form) => (
		<>
			<form.Field name="name" autofocus />
			<button>Sign up</button>
		</>
	)}
</signup.Form>
```

- `form.Fields` renders all the fields
- `form.Field` renders one field by `name` (each key in the shape)
- `form.component({ name })` exposes the low-level field components for more customization, for example if you need to change the position of the label or input
- `form.issues` and `form.values` are what a refused submission found and sent, `undefined` without one

Routes that share fields can share the component that lays them out. Give it the parts, typed by the fields they have, such as `form: Field.Bound<typeof fields>`, and render `<props.form.Field name="title" />`.

### Edit a record

Give the `Form` the record as `values`, to fill the fields with its current values. What a refused submission sent takes precedence, and values a field can't render, such as dates and `null`, are skipped.

```tsx
const update = Route.post("/posts/:id").fields(fields).use(handler);

const edit = Route.get("/posts/:id/edit").use(async (c) => {
	const post = await find(c.params.id);

	return <update.Form params={{ id: post.id }} values={post} />;
});
```

### Update a record

`result.data` is the whole record, for a create. To change one, use `result.updates`: what the request sets. It has each field that was sent, `null` for one sent empty, and nothing for one that was left out, so that field keeps its value. [`database.sql.set`](/database) writes exactly that:

```tsx
const update = Route.post("/posts/:id")
	.describe(
		"Change a post. Send the fields to change; the others stay as they are.",
	)
	// a field an agent may leave out is optional here, though the table's is not
	.fields({ title: title.optional(), body: body.optional(), tags })
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		// nothing was sent: `sql.set` needs a column
		if (Object.keys(result.updates).length)
			await database.sql`
				UPDATE ${database.posts} SET ${database.sql.set(database.posts, result.updates)}
				WHERE id = ${c.params.id}
			`;

		return c.redirect(view.url({ params: c.params }), 303);
	});
```

A form sends every field it has, so for a person nothing is left out: an emptied field is cleared. A browser sends nothing for a box that is not ticked, so a checkbox, a radio or checkbox group, and a select with `multiple()` always count as sent. An [agent](/agents#tools) sends only the arguments it gives, so one that sends `{ id, title }` changes the title and nothing else, and clears a field by sending it empty or `null`. A required field must be in every request, from a person or an agent, so make a field `.optional()` in the update route when an agent may leave it out. Sent empty, it is then `null` in the updates, which a column that is `NOT NULL` refuses, so check it or let the database's error become a message with [`result.invalid`](#errors-after-parsing).

### Errors after parsing

Some issues are only found after the data is valid, for example when a database constraint rejects a duplicate email. `result.invalid` puts messages on fields and returns an invalid result with the same `url` as a failed parse, keeping what was sent.

```tsx
const signup = Route.post("/signup")
	.fields({ email: Field.email() })
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		const [user] = await database.sql`
			INSERT INTO ${database.users} ${database.sql.values(database.users, result.data)}
			ON CONFLICT (email) DO NOTHING
			RETURNING *
		`.parse(database.users);
		if (!user) {
			const invalid = await result.invalid({ email: "Already registered" });
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
	{(form) => (
		<>
			<form.Field name="photos" options={photos.map((photo) => photo.id)} />
			<button>Publish</button>
		</>
	)}
</publish.Form>;
```

Agents see these as an array of the schema's values, such as UUIDs, without a fixed list.

A radio or checkbox group renders a `<fieldset>`. Its description follows its legend, before the options. Attributes passed as it renders, such as `class` and `id`, are the fieldset's, and each box has what `control()` set.

> An object lists keys that are whole numbers first, in number order, whatever order they were written in. Options whose values are numeric IDs are shown in that order.

A select that may be left empty, one made `.optional()`, starts with an empty choice, since a browser otherwise chooses its first option. `placeholder` is that choice's text: `Field.select(meals).optional().control({ placeholder: "Any meal" })`. A select that must be chosen starts with the choice too when it has a `placeholder`, such as "Choose a meal", and the browser asks for another. Write the choice yourself in a layout made with `component`.

#### Many choices

Every option is rendered for people and listed for agents, which suits tens of choices. For hundreds, such as picking from all of a person's recipes, use pages instead of a field:

- **The record is saved**, such as adding a recipe to a week: link to a page with a [GET form](#get-forms) that searches, and a table of results with a button in each row that posts its ID and redirects back. An agent searches with one tool and adds with another.
- **The record is not saved yet**: create it with its other fields first, then add to it as above. When the choice has to be made as the record is created, put the search field in the form with a `<button formmethod="get">`, and pass the matches as the field's options along with what is already chosen.

### Lists

`Field.textarea().lines()` is a list of text, such as a recipe's steps or tags. People write one on each line of a textarea, [agents](/agents#tools) send an array, and the route gets a `string[]` either way. Each line is trimmed, empty lines are left out, and each line is checked as the textarea checks its text, so `Field.textarea().max(80).lines()` limits each line to 80 characters. What comes after counts the lines: `Field.textarea().lines().max(10)` takes at most ten.

`Field.list()` is a list of items in order, where an item may repeat. Each item is one field, or several by name:

```tsx
const update = Route.post("/recipes/:id")
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

Set how many rows a list shows with `control`, wherever it renders, or pass `rows` to one form, as with any field's attributes. A week's seven dinners are `Field.list(Field.select(id)).max(7).control({ rows: 7 })`, and an edit form with room to add is `<form.Field name="ingredients" rows={ingredients.length + 5} />`. Every item is always shown, and a list never shows more rows than its `max()`, so a full list has no empty row.

Each control is named by its list and its place, `sides.0` or `ingredients.0.amount`, so every row's controls have their own `id` and an issue is shown on the cell it is about. The `values` given to a `Form` have a list's items as an array, as the route gets them.

An invalid submission shows a list's rows again, with each issue on its cell. When the rows are too many to [keep](#a-refused-submission), the issue is shown under the list and says where it was, such as "Row 2, Ingredient: Required field", with the field's label.

A list's `options` are those of each row's choices made from a schema, so a week's dinners show each recipe's title with no layout of their own.:

```tsx
<form.Field
	name="sides"
	options={Object.fromEntries(recipes.map((r) => [r.id, r.title]))}
/>
```

`form.component({ name: "ingredients" })` gives `Root`, `Legend`, `Description`, `Issue`, and `rows`, to lay a list out yourself. Each row is its field's component, or its fields' components by name. A row's control names its `Issue` in `aria-describedby`, but not its `Description`, since a layout shows a column's description once, not in every row:

```tsx
const Items = form.component({ name: "ingredients" });

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

A list of one field has a `<div>` for each row in place of a `<tr>`, `:scope > div`, and each row's label is its number, so set it too: `row.querySelector("label").textContent = rows.length + 1`. To write the script in JSX, keep its text in a string and render it with `<script type="module">{Render.raw({ markup: text })}</script>`, so its quotes and angle brackets are not escaped.

A list takes any field but another list or a [streamed](#streaming) file. `multiple()` is a different thing: one control that takes several of its own options or files, not rows.

## Constraints

A constraint is written once on the field. The browser checks it before the form is sent, the server checks it again, and an agent reads it in the tool's JSON Schema.

```ts
Field.text().min(2).max(80);
Field.number().min(0.5).max(5).step(0.5);
Field.number().int().min(1);
Field.date().min("2026-01-01").max("2026-12-31");
Field.text()
	.hint("3 to 30 lowercase letters, numbers, or _")
	.pattern("[a-z0-9_]{3,30}");
Field.file().accept(["image/jpeg", "image/png", "image/webp"]);
```

| Constraint                   | Fields                                      | The control gets                               |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `min(length)`, `max(length)` | Text inputs and a textarea                  | `minlength`, `maxlength`                       |
| `min(number)`, `max(number)` | `number`, `range`                           | `min`, `max`                                   |
| `int()`                      | `number`, `range`                           | Nothing: a number input takes whole numbers    |
| Not `int()`                  | `number`, `range`                           | `step="any"`, so it takes decimals             |
| `step(n)`                    | `number`, `range`                           | `step`                                         |
| `min(value)`, `max(value)`   | `date`, `datetime`, `month`, `week`, `time` | `min`, `max`                                   |
| `pattern(source)`            | Text inputs                                 | `pattern`, and the field's hint as its `title` |
| `accept(types)`              | `file`                                      | `accept`                                       |

- A picker's earliest and latest values are written as the picker writes one: `"2026-01-01"` for a date, `"09:00"` for a time, `"2026-W10"` for a week. Another format is a type error.
- `Schema.date()`, whose value is a `Date`, such as a table's `created`, takes the same: `Schema.date().min("2026-01-01")`, or a date and time such as `"2026-12-31T23:59:59Z"`.
- `pattern` takes the expression as the HTML attribute does: without slashes or flags, and matched by the whole value. A browser shows the control's `title` when the value does not match, which is the field's hint, or its description: say there what the value must be. `Schema.string().pattern()` checks the same way without a control.
- `accept` takes media types, and `image/*` for any image. A file that does not say its type is refused. The type is the one the sender gives, so serve a file back with the type that was checked. `image/*` includes SVG, a document that can run scripts, so name the types when people open each other's files.
- `accept`, `pattern`, and a number's `step` are not attributes for `control()`, where only the browser would check them.
- `step(n)` takes multiples of `n`, counted from zero: `step(0.5)` is halves. A browser counts from the control's `min` instead, so when a range starts between steps, such as `min(1).step(2)`, the control takes any number and the server checks the step.
- An attribute passed as a form renders replaces the field's own, such as a later `min` on one form's date: `<plan.Field name="start" min={today} />`. The server still checks what the field says.
- A check made after `transform()` is of the changed value, not the control's, so only the server makes it. Each line's length in `lines()` is the server's too.
- A browser counts a character outside the basic plane, such as an emoji, as two toward `maxlength`, where the server counts it as one. A field of emoji fills at half its `max()` in the browser.

## Input normalization

ovr also normalizes a few common HTML form quirks before validation:

- Single-value text-like inputs read blank values as missing during form parsing, so optional fields are omitted from the parsed output and `.default(...)` still applies like you would expect.
- `Field.number()` and `Field.range()` coerce submitted strings into numbers, while blank submissions still count as missing instead of becoming `0`. Text that is not a number, which only something other than a browser sends, is answered with "Enter a number". Integers beyond `Number.MAX_SAFE_INTEGER` fail validation instead of being rounded.
- `Field.checkbox()` reads presence as a boolean, so omitted checkboxes become `false`.
- `Field.date()`, `Field.datetime()`, `Field.month()`, `Field.week()`, `Field.time()`, and `Field.color()` check that the value is in the format a browser's picker sends, and that a date is a day of the calendar. A browser sends nothing else, but an agent or a script may, and gets an issue such as "Enter a date as YYYY-MM-DD".
- `Field.file()` and `Field.file().multiple()` treat the browser's [empty placeholder file](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-form-data-set) as missing, while real zero-byte named files are still preserved.

## A refused submission

When a route refuses a submission, `c.data()` keeps the issues and what was sent, and its `url` is the page the form is on. There, the form shows it again:

- each field has what the person typed
- the matching issue message is under its field
- `aria-invalid` and `aria-describedby` are set
- the first invalid field has the focus

Only the form it was sent to shows it. Another form on the page with the same fields, such as the one in the next row, keeps its own values.

It is kept in a cookie, compressed, for an hour. Only the page the form is on is sent the cookie, no script can read it, and the address names it with a short ID, such as `?_form=3f9a2c1e`. So nothing a person typed is in an address, a history, or a log, and the page opened without the ID starts over. A file and a password are never kept.

A cookie holds about 4 KB, which is a long form once it is compressed: a recipe of 100 ingredients, its steps, and its notes. When there is more, values are left out, from the form's last field back, until it fits. The issues are kept, so the person sees what was wrong, but not what they typed in the fields left out. A list shows no more rows than its `max()`, and a row's hidden value, such as its ID, is the page's to give.

The form's parts have its `issues`, to act on a refused submission, such as opening the `<details>` its fields are in:

```tsx
<create.Form>
	{(form) => (
		<details open={Boolean(form.issues)}>
			<summary>Add a recipe</summary>
			<form.Fields />
			<button>Add</button>
		</details>
	)}
</create.Form>
```

## GET forms

`Route.get` takes fields too, for a form that sends its values as search params. Its submission is the page's URL, so its form fills the fields from it, and shows what is wrong with them once the URL has any. Only a GET route's form reads its fields from search params, since that is where it submits them. Other forms show just what a [refused submission](#a-refused-submission) kept, so a link cannot fill in an edit form.

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

		if (result.issues) return <search.Form />;

		result.data; // { q: "travel backpack", minPrice: 50, inStock: true }

		// fetch results...

		return (
			<>
				<search.Form />
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

- `Context.data()` automatically sets the multipart `parts` limit from the schema. Single inputs count as `1`, checkbox groups and a select with `multiple()` count by their number of options, a list counts its fields for each row it takes, and a file with `multiple()`, a group made from a schema, or `Field.textarea().lines()` has no limit.
- You can still override the parser per request with `Context.data({ parts, memory, payload })`.
- A body over a limit, such as more parts than the form has fields, throws a `Multipart.Limit`, one that is not multipart form data a `Multipart.Unsupported`, and malformed form data a `Multipart.Malformed`. Browsers submitting your form never send any of these. Left uncaught by the route, ovr answers them itself: 413 for a body over a limit, 415 for another content type, and 400 for malformed form data. Catch them in the route's own [middleware](/middleware) to answer differently; global middleware that [catches errors](/middleware#not-found-and-errors) sees the answer, not the error.
- App-wide multipart defaults can be set with `new App({ multipart: { memory, payload, parts } })`.
- Unexpected names in `FormData` or multipart requests become validation issues instead of being silently accepted. A list takes only the names of its own cells, such as `ingredients.0.amount`.
- A list takes as many rows in one request as its `max()`, and 1,000 without one. A request with more is refused as over the `parts` limit, before its rows are read.
