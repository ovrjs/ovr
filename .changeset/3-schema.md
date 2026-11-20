---
"ovr": major
---

Schemas describe themselves as JSON Schema, and parse about twice as fast.

**Changed**

- **Construction:** `new Schema(def)` and `schema.derive()` are protected, so a schema is made with `Schema`'s static methods. The `Schema.Parse.Constructor` type is removed.
- **Strings:** `min` and `max` count Unicode characters instead of UTF-16 code units, as JSON Schema and Postgres do, so an emoji counts as one.

**New**

- **JSON Schema:** `schema.toJsonSchema()`, and Standard JSON Schema through `~standard.jsonSchema`, for draft 2020-12 or draft-07.
- **`describe(text)`** is a schema's `description` in JSON Schema.
- **`Schema.date()`**, which takes an earliest and latest date with `min()` and `max()`, and **`.uuid()`**.
- **`pattern(source)`** checks that the whole string matches, and **`step(n)`** that a number is a multiple of `n`.
- **Arrays:** `min()` and `max()` count an array's items.

**Fixed**

- **`__proto__`:** a `__proto__` key is kept as data, instead of changing the parsed object's prototype.
- **Types:** the published types compile without Node's types.
