---
"ovr": major
---

The route's `Form` renders its fields, shows a refused submission, and is the one way to make a form.

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

- **`Form` is not exported.** The route no longer has the form's `parse`, `shape`, `names`, `parts`, `extend`, `pick`, and `omit`, and `Form.from()` and `Route.Schema` are removed. To share fields, reuse the shape object, typed `Field.Shape`. Parsed fields are typed `Field.Parse.Data<typeof shape>`.
- **Rendering:** `<route.Form />` renders every field and a submit button. To lay the fields out, give it a function child, which is given `Field`, `Fields`, `component({ name })`, `issues`, and `values`. `route.Field`, `route.Fields`, and `route.component()` are removed. A component shared by routes takes those parts, typed `Field.Bound<typeof fields>`.
- **Refused submissions:** delete each `.persist()` and `state={...}`. The form reads the request itself, and every field keeps what was sent, except a file and a password. What was sent is kept for an hour in an HttpOnly cookie, where it was in the URL.
- **Redirect on issues:** redirect to `result.url`; `result.search` is removed.
- **Attributes:** the object each field took is removed. `Field.text({ label: "Name", placeholder: "Ross" })` is `Field.text().label("Name").control({ placeholder: "Ross" })`.
- **Many values:** `Field.file().multiple()` and `Field.select(options).multiple()` replace `Field.files()` and `Field.multiselect(options)`.
- **Choices:** a field's choices are its `options`, where they were `values`.
- **Constraints:** `accept`, `pattern`, and a number's `step` are type errors in `control()`; use the methods below.
- **IDs:** a field's `id` starts with the form's method and address, such as `post_signup-name`, so two forms on a page never share one. Select fields by `name`.
- **Groups:** attributes passed to a radio or checkbox group, such as `class`, are its fieldset's, where every box had them.
- **Required:** a control is `required` when leaving it empty fails validation, except checkboxes. Pass `required={false}` to leave it out.
- **Messages:** a choice field says "Select an option", a number field sent text says "Enter a number", and `min()` and `max()` say "At least 2" and "At most 80 characters".
- **Limits:** a field that takes any number of values takes at most 1000, where it had no limit.

**New**

- **`label()`, `describe()`, `hint()`:** `label()` names the field. `describe()` says how to fill it in, shown under the control. `hint()` is what people read in place of a description written for agents.
- **`values`:** `<route.Form values={record} />` fills the fields to edit a record.
- **`result.updates`** is what a request sets, to update a record with: each field sent, `null` for one sent empty, and nothing for one left out.
- **`result.invalid(messages)`** puts issues found after parsing, such as a database constraint, on fields: `c.redirect((await result.invalid({ email: "Already registered" })).url, 303)`.
- **`route.issues(c, params)`** reads whether a submission to the route's form was refused, for the page around the form.
- **Constraints the browser checks too:** `min()` and `max()` write `minlength`, `maxlength`, `min`, and `max`. `step(n)`, `pattern(source)`, and `Field.file().accept(types)` write their attributes and are checked on the server. Date and time fields take `min()` and `max()`.
- **Choices with labels:** `Field.select({ dinner: "Dinner", crockpot: "Slow cooker" })`, and the same for `radio` and `checkboxes`.
- **Choices from a schema:** `Field.checkboxes(Schema.string().uuid())`, and the same for `radio` and `select`, for options only known as the page renders, passed as `options` to the field.
- **Empty select:** a select that is `optional()` starts with an empty choice, whose text is its `placeholder`.
- **Lists:** `Field.textarea().lines()` is a list of text, one on each line. `Field.list(item)` is a list of items in order, each one field or several by name, rendered as rows.

**Fixed**

- **Filling from the URL:** only a GET route's form fills its fields from search params. A link such as `/account/edit?role=admin` can no longer fill in a POST form.
- **Pickers:** a date, datetime, month, week, time, or color field checks its value's format, and that a date is a real day. Before, any text passed.
- **Numbers:** a number field takes only decimal text, and rejects integers beyond `Number.MAX_SAFE_INTEGER` instead of rounding them.
- **Streamed files:** a `stream()` file is checked by its name and type before its body is read.
