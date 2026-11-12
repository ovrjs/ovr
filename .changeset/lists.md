---
"ovr": minor
---

`Field.list()` and `Field.textarea().lines()` are lists a route gets as an array, from people and agents alike, so one route serves both.

- `Field.textarea().lines()` is a list of text, such as steps or tags. People write one on each line of a textarea and agents send an array of strings.
- `Field.list(item)` is a list of items in order, where an item may repeat. Each item is one field, such as `Field.list(Field.select(Schema.string().uuid()))`, or several by name, such as `Field.list({ amount: Field.number(), name: Field.text() })`. It renders a row for each item and an empty one, and agents send an array. `rows` sets how many rows to show, and `component` gives each row's components for a custom layout.
- An agent reading an edit form's page through MCP sees a list's current items as the array its tool takes.
