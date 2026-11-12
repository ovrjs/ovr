---
"ovr": patch
---

- A select that may be left empty, such as `Field.select(options).optional()`, starts with an empty choice. Before, the browser chose its first option, so it could not be left empty.
- Text sent to a number field, such as an agent's `"Keep"`, is answered with "Enter a number" instead of "Required field". A number field left empty is still a required field.
- A date, time, month, week, or color field without a description of its own ends its format as a sentence, such as `Date as YYYY-MM-DD.`
