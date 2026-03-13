---
"ovr": patch
---

fix(router): throw on conflicting param names at the same path segment

Adding sibling routes like `/:id` and `/:name` at the same segment now throws a conflict error instead of registering ambiguous parameter names.
