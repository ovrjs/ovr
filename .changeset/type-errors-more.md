---
"ovr": major
---

Three more of the developer's own mistakes are type errors instead of runtime checks:

- An Auth `page`, `redirect`, or `consent` path that is not a local path of the app's own, such as `https://example.com`, `/login?next=1`, or `/login/`, and a `page` that is one of Auth's endpoints. A path that is not written out, such as one read from the environment, is taken as it is.
- `params()` or `fields()` called after `use()`. `use()` returns the route with neither, since its middleware is typed by them.
- An empty table, column, or schema name, or one with a NUL character.
