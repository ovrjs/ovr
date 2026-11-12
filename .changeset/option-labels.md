---
"ovr": minor
---

- `Field.select()`, `Field.radio()`, and `Field.checkboxes()` take an object of each value and its label, such as `Field.select({ dinner: "Dinner", crockpot: "Slow cooker" })`. People see the label, the value is what is sent, and the tool's description tells agents each value's label. `options` given as a form renders takes the same, such as `{ [recipe.id]: recipe.title }`, which a list passes to each row.
- `placeholder` on a select is the text of its empty first choice, such as `control({ placeholder: "Any meal" })`. A select that must be chosen starts with that choice too when it has one.
- A list of several fields renders as a table: a column for each field, named and described once in its heading, and a row for each item with each cell's control and issue. A list of one field is unchanged.
