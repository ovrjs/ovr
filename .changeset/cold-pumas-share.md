---
"ovr": patch
---

fix(form): make `result.search` URLSearchParams-compatible

The undocumented `result.search` value returned from invalid form parses is now exposed as a single-entry search params init (`[["_form", value]]`). This lets it work directly with `new URLSearchParams(...)`, route `url({ search })` helpers, and similar URL APIs without reshaping the value first.
