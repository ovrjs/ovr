---
"ovr": major
---

A field's label is set with `label()`, and `describe()` says how to fill it in, chained like its rules and like a route's `describe()`:

```ts
Field.url().label("URL").describe("An http or https address").max(300);
```

The `label` property is removed, and passing it is a type error: `Field.text({ label: "Title" })` becomes `Field.text().label("Title")`. The object a field takes holds only attributes for its control, such as `placeholder`.

People see the description in a paragraph under the control, which the control names in `aria-describedby`. Agents read the label as the field's `title` and the description as its `description`, in a tool's input schema and in `toJsonSchema()`. A table's field carries both into every form and tool that uses it. `component()` has a `Description` part to place it in a custom layout.
