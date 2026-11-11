---
"ovr": major
---

More of the developer's own mistakes are type errors instead of runtime checks:

- An Auth `page`, `redirect`, or `consent` path that is not a local path of the app's own, such as `https://example.com`, `/login?next=1`, or `/login/`, and a `page` that is one of Auth's endpoints. A path that is not written out, such as one read from the environment, is taken as it is.
- `params()` or `fields()` called after `use()`. `use()` returns the route with neither, since its middleware is typed by them.
- An empty table, column, or schema name, or one with a NUL character.
- A route pattern written out that does not start with `/`, or holds a query, a fragment, or whitespace, and an MCP endpoint `path` that is not a fixed path of the app's own.
- A table column that may be left out, with `optional()` or `nullish()`; use `nullable()` or the `default` option.

A route parameter can be given to `route.url()`, `Anchor`, `Form`, and `Button` as a number or a bigint, as a `params` schema may have converted it.
