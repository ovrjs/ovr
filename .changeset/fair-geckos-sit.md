---
"ovr": patch
---

fix(schema): avoid TS7056 on exported object schemas using mode helpers

`Schema.object(...).strict()` and `Schema.object(...).loose()` now return the public object schema alias instead of exposing the concrete internal object schema type. This avoids declaration emit failures like TS7056 when exporting larger object schemas. The same return-type cleanup also applies to `pick()` and `omit()`.
