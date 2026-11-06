---
"ovr": minor
---

Add `Schema.toJsonSchema()` and Standard JSON Schema support through `~standard.jsonSchema`, targeting JSON Schema draft 2020-12 or draft-07. A form field's `label` is its `title`, and a `Field.checkbox()` is optional in input schemas, with a default of `false`, as an unchecked box is left out of a form. A property named `__proto__` is an own property.

String `min` and `max` now count Unicode characters instead of UTF-16 code units, matching JSON Schema and Postgres, so an emoji counts as one character.

Schema parsing is about twice as fast for both valid and invalid values: nested schemas share one issue path, copied only into issues, and build one `Schema.AggregateIssue`.

Remove the unused `Schema.Parse.Constructor` type.
