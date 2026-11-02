---
"ovr": minor
---

Add `Schema.toJsonSchema()` and Standard JSON Schema support through `~standard.jsonSchema`, targeting JSON Schema draft 2020-12 or draft-07.

String `min` and `max` now count Unicode characters instead of UTF-16 code units, matching JSON Schema and Postgres, so an emoji counts as one character.

Schema parsing is about twice as fast for both valid and invalid values: nested schemas share one issue path, copied only into issues, and build one `Schema.AggregateIssue`.
