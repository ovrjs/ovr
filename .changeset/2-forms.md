---
"ovr": major
---

A form is a route's fields. The route's `Form` renders them, shows a refused submission, and is the one way to make a form.

```tsx
// before
const update = Route.post(
	"/posts/:id",
	{ title: Field.text({ label: "Title" }).persist() },
	handler,
);

<update.Form params={{ id }} state={c.url}>
	<update.Field name="title" state={c.url} />
	<button>Save</button>
</update.Form>;

// after
const update = Route.post("/posts/:id")
	.fields({ title: Field.text().label("Title") })
	.use(handler);

<update.Form params={{ id }} values={post}>
	{(form) => (
		<>
			<form.Field name="title" />
			<button>Save</button>
		</>
	)}
</update.Form>;
```

**Changed**

- **`Form` is not exported.** `route.fields(shape)` gives a route its fields, and the route no longer has the form's `parse`, `shape`, `names`, `parts`, `extend`, `pick`, and `omit`. To share fields, reuse the shape object, typed `Field.Shape`. `Form.from()` and `Route.Schema` are removed. Parsed fields are typed `Field.Parse.Data<typeof shape>`.
- **Rendering:** `<route.Form />` renders the route's fields and a submit button labelled with `submit`. To lay the fields out, give it a function child, which is given `Field`, `Fields`, `component({ name })`, `issues`, and `values`. `route.Field`, `route.Fields`, and `route.component()` are removed. A component shared by routes takes those parts, typed `Field.Bound<typeof fields>`.
- **Refused submissions:** the `state` prop and `persist()` are removed. The form reads the request itself, and every field keeps what was sent, except a file and a password. Delete each `.persist()` and `state={...}`. What was sent is kept for an hour in the compressed, HttpOnly `__Host-form` cookie, where it was in the URL, and the redirect names it with a short ID, `?_form=3f9a2c1e`. Only the form it was sent to shows it: forms are told apart by their address, then by their `Field.hidden()` values.
- **Redirect on issues:** redirect to `result.url`; `result.search` is removed. A GET route renders its form in place of redirecting.
- **Attributes:** the object each field took is removed. `Field.text({ label: "Name", placeholder: "Ross" })` is `Field.text().label("Name").control({ placeholder: "Ross" })`, and `Field.select(options, attributes)` is `Field.select(options).control(attributes)`.
- **Many values:** `Field.file().multiple()` and `Field.select(options).multiple()` replace `Field.files()` and `Field.multiselect(options)`.
- **Choices:** a field's choices are its `options`, where they were `values`: `field.options`, and `options` on a select's, a radio group's, or a checkbox group's components.
- **Constraints in `control()`:** `accept`, `pattern`, and a number's `step` are type errors in `control()`, where only the browser checked them. Use the methods below. Remove `control({ step: "any" })`: a number that is not `int()` gets it.
- **IDs:** a field's `id` starts with the form's method and address, such as `post_signup-name`, so two forms on a page never share one. Select fields by `name`.
- **Groups:** attributes passed to a radio or checkbox group, such as `class`, are its fieldset's, where every box had them.
- **Required:** a control is `required` when leaving it empty fails validation, except checkboxes. Pass `required={false}` to leave it out.
- **Filling from the URL:** only a GET route's form fills its fields from search params. A link such as `/account/edit?role=admin` can no longer fill in a POST form.
- **Messages:** a choice field says "Select an option", a number field sent text says "Enter a number", and `min()` and `max()` say "At least 2" and "At most 80 characters".
- **Pickers:** a date, datetime, month, week, time, or color field checks its value's format, and that a date is a real day. Before, any text passed.
- **Numbers:** a number field takes only decimal text, and rejects integers beyond `Number.MAX_SAFE_INTEGER` instead of rounding them.
- **Limits:** a field that takes any number of values, such as `Field.file().multiple()`, takes at most 1000, where it had no limit, and a form's parts stay within the app's `multipart.parts`.
- **Streamed files:** a `stream()` file is checked by its name and type before its body is read, and `result.stream` holds only the parts of streamed fields that pass.

**New**

- **`label()`, `describe()`, `hint()`:** `label()` names the field. `describe()` says how to fill it in, shown under the control and named in `aria-describedby`. `hint()` is what people read in place of a description written for agents.
- **`values`:** `<route.Form values={record} />` fills the fields to edit a record.
- **`result.updates`** is what a request sets, to update a record with: each field sent, `null` for one sent empty, and nothing for one left out. `database.sql.set(table, result.updates)` writes it.
- **`result.invalid(messages)`** puts issues found after parsing, such as a database constraint, on fields: `c.redirect((await result.invalid({ email: "Already registered" })).url, 303)`.
- **`route.issues(c, params)`** reads whether a submission to the route's form was refused, for the page around the form, such as to open its `<details>`.
- **Constraints the browser checks too:** `min()` and `max()` write `minlength`, `maxlength`, `min`, and `max`. `step(n)`, `pattern(source)`, and `Field.file().accept(types)` write their attributes and are checked on the server. Date and time fields take `min()` and `max()` written as the picker writes a value.
- **Choices with labels:** `Field.select({ dinner: "Dinner", crockpot: "Slow cooker" })`, and the same for `radio` and `checkboxes`.
- **Choices from a schema:** `Field.checkboxes(Schema.string().uuid())`, and the same for `radio` and `select`, for options only known as the page renders, passed as `options` to the field.
- **Empty select:** a select that is `optional()` starts with an empty choice, whose text is its `placeholder`.
- **Lists:** `Field.textarea().lines()` is a list of text, one on each line. `Field.list(item)` is a list of items in order, each one field or several by name, rendered as rows. A route gets an array from people and agents alike. `min()` and `max()` count the items.
- **`Field.taken(message)`** is what registration says when another user has the value, see the auth entry.
