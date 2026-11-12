---
"ovr": patch
---

- A registration field that fails its schema shows its own message, such as a `refine()`'s, in place of "Check this field." The registration options endpoint answers 422 with `{ fields: { name: message } }`.
- The agents docs give both codes for a missing resource: -32602, and -32002 for clients of the 2025 versions.
