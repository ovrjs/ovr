---
"ovr": major
---

Schemas describe themselves as JSON Schema, and parse about twice as fast.

**Changed**

- **Construction:** `new Schema(def)` and `schema.derive()` are protected, so a schema is made with `Schema`'s static methods. The unused `Schema.Parse.Constructor` type is removed.
- **Strings:** `min` and `max` count Unicode characters instead of UTF-16 code units, as JSON Schema and Postgres do, so an emoji counts as one.
- **`__proto__`:** a `__proto__` key is kept as data, instead of changing the parsed object's prototype.

**New**

- **JSON Schema:** `schema.toJsonSchema()`, and Standard JSON Schema through `~standard.jsonSchema`, for draft 2020-12 or draft-07. A literal or an enum says its values' type.
- **`describe()`** is a method of every schema, its `description` in JSON Schema. `schema.description` reads it back.
- **`Schema.date()`**, which takes an earliest and latest date with `min()` and `max()`, and **`.uuid()`**.
- **`pattern(source)`** checks that the whole string matches, and **`step(n)`** that a number is a multiple of `n`.
- **Arrays:** `min()` and `max()` count an array's items.
- **`schema.def`** is the definition a schema was built from.
- **Types:** declaration files name `Schema.Issue` and `Schema.AggregateIssue`, and the published types compile without Node's types.
