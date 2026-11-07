---
"ovr": minor
---

Route forms take a `submit` label for their generated button. Route forms and fields accept `values` to edit a record, under any values restored from an invalid submission. Valid `c.data()` results add `invalid(messages)` to put issues found after parsing, such as a database constraint, on fields.

`Field.number()` and `Field.range()` reject integers beyond `Number.MAX_SAFE_INTEGER` instead of rounding them. Cleared persisted fields are kept empty in invalid form state, so they stay cleared over initial values.

Generated controls are `required` when leaving them empty fails validation, except checkboxes, so browsers, screen readers, and agents reading Markdown know before submitting. Pass `required={false}` to leave it out.
