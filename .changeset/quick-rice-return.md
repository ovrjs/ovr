---
"ovr": patch
---

fix(form): fail fast when `c.data()` is called after consuming `c.form()`

`c.form()` no longer caches a multipart parser on the context. If the request body has already been consumed through `c.form()`, a later call to `c.data()` now throws immediately instead of reusing stale parser state.
