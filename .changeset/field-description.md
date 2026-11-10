---
"ovr": minor
---

A field takes a `description`, how to fill it in: `Field.url({ label: "URL", description: "An http or https address" })`. People see it in a paragraph under the control, which the control names in `aria-describedby`, and agents read it as the field's `description` in a tool's input schema and in `toJsonSchema()`, as its `label` is the `title`. A table's field carries its description into every form and tool that uses it. `component()` has a `Description` part to place it in a custom layout.
