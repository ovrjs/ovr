---
"ovr": patch
---

fix(types): `Context.json` no longer accepts `bigint` as an input since `bigint` cannot be passed into `JSON.stringify`.
