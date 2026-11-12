---
"ovr": minor
---

- `min()` and `max()` count an array's items: `Schema.array(schema).max(5)`, `Field.textarea().lines().max(10)`, `Field.checkboxes(tags).max(3)`, and `Field.list(item).min(2)`. They are `minItems` and `maxItems` in its JSON Schema. Before `lines()`, they still check each line's text.
- `Field.list(item).control({ rows })` sets how many rows the list shows wherever it renders, and `rows` on one form overrides it, as with any field's attributes. A list never shows more rows than its `max()`, so a full list has no empty row.
