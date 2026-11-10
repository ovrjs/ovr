---
"ovr": minor
---

A field takes a `hint`, help for filling it in: `Field.url({ label: "URL", hint: "An http or https address" })`. People see it in a paragraph under the control, which the control names in `aria-describedby`, and agents read it as the field's `description` in a tool's input schema and in `toJsonSchema()`. A table's field carries its hint into every form and tool that uses it. `component()` has a `Hint` part to place it in a custom layout.
