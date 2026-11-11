---
"ovr": major
---

Mistakes in your own code are type errors instead of runtime checks, so they are found while you write the code and cost nothing at runtime:

- `new Auth()` needs `Auth.tables` and its users table in its database, a users table with an `id` and without the `credential`, `ceremony`, or `bootstrap` fields passkey forms send.
- `new Limiter()` needs `Limiter.table` in its database.
- `c.redirect(route)` needs a route without parameters; use `route.url({ params })`.
- `new Table()` needs a name, and `default` lists its own columns. An empty table, column, or schema name, or one with a NUL character, is a type error too, as is a column that may be left out, with `optional()` or `nullish()`; use `nullable()` or the `default` option.
- A route pattern written out must start with `/`, and cannot hold a query, a fragment, or whitespace, and an MCP endpoint `path` must be a fixed path of the app's own.
- `params()` or `fields()` called after `use()`. `use()` returns the route with neither, since its middleware is typed by them.
- An Auth `page`, `redirect`, or `consent` path that is not a local path of the app's own, such as `https://example.com`, `/login?next=1`, or `/login/`, and a `page` that is one of Auth's endpoints. A path that is not written out, such as one read from the environment, is taken as it is.
- A route pattern cannot run a parameter into the wildcard, as in `/:id*`, since nothing tells where one ends and the other starts; use `/:id/*`.
- `route.describe()` needs text that is not blank, whatever whitespace it holds, and a pattern without both a `:wildcard` parameter and a `*` wildcard, which would both be the tool's `wildcard` argument.

Checks stay at runtime where a type cannot see the value: options often read from the environment, such as Auth's origin and secret; values from requests, files, or the database; what else is mounted; and mistakes that would open a hole for an attacker, such as calling `sql` with a string instead of a template.

Numbers in options are not checked, such as a `Limiter`'s `limit` and `interval` or Auth's session times, so a value read from the environment needs to be a number that makes sense.
