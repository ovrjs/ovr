---
"ovr": minor
---

feat(schema): add `Schema`, `Field`, and `Form` helpers for typed parsing and form rendering

This adds a built-in schema layer for validating values, parsing search params and multipart form data with `c.data()`, and rendering forms with reusable field helpers.

Highlights:

- `Schema` for parsing, refinement, transformation, and object/array composition
- `Field` and `Form` helpers for typed HTML controls and render-state handling
- Support for persisted invalid form values and streamed multipart uploads

Docs: https://ovrjs.com/07-schema
