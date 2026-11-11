---
"ovr": major
---

Schemas describe themselves as JSON Schema, and parse about twice as fast.

- **JSON Schema:** `schema.toJsonSchema()` and Standard JSON Schema support through `~standard.jsonSchema`, targeting draft 2020-12 or draft-07. A field's label is its `title`, and a `Field.checkbox()` is optional in input schemas, with a default of `false`, as an unchecked box is left out of a form.
- **Descriptions:** `describe()` is a method of every schema: `Schema.string().uuid().describe("The bookmark's ID")` is that value's `description` in its JSON Schema, so a route's `params` describe a tool's arguments to agents. A field inherits it, and also shows the text under its control. `schema.description` reads it back, through what wraps it, such as `optional()`.
- **New schemas:** `Schema.date()` and `.uuid()`. Schemas keep the definition they were built from in `schema.def`.
- **Issue types:** declaration files name `Schema.Issue`, `Schema.AggregateIssue`, and `Markup.Chunk`, where they copied their members.
- **Construction:** `new Schema(def)` and `schema.derive()` are protected, so a schema is made with `Schema`'s static methods.
- **Strings:** `min` and `max` count Unicode characters instead of UTF-16 code units, matching JSON Schema and Postgres, so an emoji counts as one character.
- **Speed:** nested schemas share one issue path, copied only into issues, and build one `Schema.AggregateIssue`.
- **Fixes:** a `__proto__` key is kept as data, in an object's shape, passed through by `loose()`, or named by `pick` or `omit`, instead of changing the parsed object's prototype, and is an own property in JSON Schema. Unions and arrays with very many issues no longer overflow the stack. The published types compile without Node's types.

The unused `Schema.Parse.Constructor` type is removed.
