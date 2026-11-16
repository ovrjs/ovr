---
"ovr": minor
---

A field's constraints are written once and checked by the browser, the server, and shown to agents.

- `min()` and `max()` write `minlength` and `maxlength` on text inputs and textareas, and `min` and `max` on number and range inputs. They were only checked on the server.
- A number or range input that is not `int()` gets `step="any"`, so the browser takes the decimals the server does. Remove `control({ step: "any" })`.
- Date and time fields take an earliest and latest value: `Field.date().min("2026-01-01").max("2026-12-31")`, and the same for `datetime`, `month`, `week`, and `time`, each written as its picker writes a value.
- `pattern(source, message)` checks that the whole string matches, as an input's `pattern` attribute does. A text input gets the attribute, with the message as its `title`, and the tool's JSON Schema gets the pattern. It replaces a `pattern` in `control()` repeated in a `refine`.
- `Field.file().accept(["image/jpeg", "image/png"])` sets the picker's types and refuses any other on the server, also a file that does not say its type. Agents read the types in the tool's description.

`accept` and `pattern` are now a type error in `control()`, where only the browser checked them. Use the methods.
