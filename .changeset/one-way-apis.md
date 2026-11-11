---
"ovr": major
---

- `JSX` is exported as a type only. The JSX runtime is `ovr/jsx-runtime`, which TypeScript and bundlers load from `jsxImportSource`.
- The multipart parser is named `multipart` wherever it appears, so "form" means a route's fields and the `<form>` they render: `c.form()` is `c.multipart()`, and `new App({ form })` is `new App({ multipart })`.
- The multipart errors are `Multipart.Limit`, `Multipart.Malformed`, and `Multipart.Unsupported`, so a route that catches them can tell them apart from its own errors.
- A field's choices are its `options`, as the `<option>` elements they render, so `values` means only a record's values: `field.options`, and `options` on a select's, a radio group's, or a checkbox group's components.
- `multiple()` takes more than one value, chained like a field's other rules: `Field.file().multiple()` and `Field.select(options).multiple()` replace `Field.files()` and `Field.multiselect(options)`. `Field.checkboxes()` and `Field.radio()` stay, since each is a group of controls.
- Auth form message parts are `Register.Issue` and `Login.Issue`, as a field's is its `Issue`, instead of `Register.Error` and `Login.Error`.
- `Markup` yields strings of markup, as `Markdown` yields strings of Markdown, instead of chunk objects to call `toString()` on.
- Members ovr uses between its own modules are no longer part of the API: `route.paramSchemas`, a field's `render()` and `component()`, and the Markdown option that writes a form as an MCP tool call. `new Schema(def)` and `schema.derive()` are protected, so a schema is made with `Schema`'s static methods.
