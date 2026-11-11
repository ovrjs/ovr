---
"ovr": major
---

Forms are a route's fields, set up by chaining, like a field's rules and like a route:

```ts
Field.url()
	.label("URL")
	.describe("An http or https address")
	.control({ placeholder: "https://" })
	.max(300);
```

- **Fields from a shape:** `route.fields(shape)` is the one way to give a route fields, and `Form` is internal. A route renders them with `Field`, `Fields`, and `component`, and no longer has the form's `parse`, `shape`, `names`, `parts`, `extend`, `pick`, and `omit`. To share fields, reuse the shape object, typed `Field.Shape`. The types of what fields parse and keep are `Field.Parse`, `Field.Value`, and `Field.State`. `Form.from()` and `Route.Schema` are removed, and a field's own `render()` and `component()` are no longer part of the API.
- **Label, description, and attributes:** `label()` names the field, and the `label` property is removed. `describe()` says how to fill it in: people see it in a paragraph under the control, which the control names in `aria-describedby`, and `component()` has a `Description` part to place it in a custom layout. `control()` gives the control its attributes. The object each field took is removed: `Field.text({ placeholder: "Name" })` becomes `Field.text().control({ placeholder: "Name" })`, and `Field.select(options, attributes)` becomes `Field.select(options).control(attributes)`. Each of the old forms is a type error. A table's field carries all three into every form and tool that uses it.
- **Choices:** a field's choices are its `options`, as the `<option>` elements they render, so `values` means only a record's values: `field.options`, and `options` on a select's, a radio group's, or a checkbox group's components.
- **Many values:** `multiple()` takes more than one value, chained like a field's other rules: `Field.file().multiple()` and `Field.select(options).multiple()` replace `Field.files()` and `Field.multiselect(options)`. `Field.checkboxes()` and `Field.radio()` stay, since each is a group of controls.
- **Editing a record:** route forms and fields accept `values`, under any values restored from an invalid submission. Valid `c.data()` results add `invalid(messages)` to put issues found after parsing, such as a database constraint, on fields. Cleared persisted fields stay empty in invalid form state, so they stay cleared over initial values.
- **Submit button:** a route's `Form` renders its fields, if any, and a submit button labelled with `submit`, so one without fields, such as a delete, is no longer empty; children replace both.
- **Filling from the URL:** only a GET route's form fills its fields from search params of the same name. Other forms restore just the values they persisted in `_form`, so a link such as `/account/edit?role=admin` can no longer fill in a form, its hidden and password fields included, over the `values` passed to it.
- **Required:** generated controls are `required` when leaving them empty fails validation, except checkboxes, so browsers, screen readers, and agents reading Markdown know before submitting. Pass `required={false}` to leave it out.
- **Messages:** radio, select, and checkbox fields say "Select an option" when nothing or an option that is not offered is sent, instead of "Required field". Field names such as `constructor` are unexpected fields, not inherited properties.
- **Numbers:** `Field.number()` and `Field.range()` reject integers beyond `Number.MAX_SAFE_INTEGER` instead of rounding them.
