---
"ovr": major
---

A field is set up by chaining, like its rules and like a route:

```ts
Field.url()
	.label("URL")
	.describe("An http or https address")
	.control({ placeholder: "https://" })
	.max(300);
```

- `label()` names the field. The `label` property is removed.
- `describe()` says how to fill it in. People see it in a paragraph under the control, which the control names in `aria-describedby`.
- `control()` gives the control its attributes. The object each field took is removed: `Field.text({ placeholder: "Name" })` becomes `Field.text().control({ placeholder: "Name" })`, and `Field.select(values, attributes)` becomes `Field.select(values).control(attributes)`.

Each of the old forms is a type error. Agents read the label as the field's `title` and the description as its `description`, in a tool's input schema and in `toJsonSchema()`. A table's field carries all three into every form and tool that uses it. `component()` has a `Description` part to place the description in a custom layout.

`describe()` is a method of every schema, not only fields: `Schema.string().uuid().describe("The bookmark's ID")` is that value's `description` in its JSON Schema, so a route's `params` describe a tool's arguments to agents. A field inherits it, and also shows the text under its control. `schema.description` reads it back, through what wraps it, such as `optional()`.
