---
"ovr": major
---

Mistakes in your own code are type errors instead of runtime checks, so they are found as you write and cost nothing at runtime:

- A route pattern written out must start with `/`, and cannot hold a query, a fragment, or whitespace, or run a parameter into the wildcard, as in `/:id*`; use `/:id/*`.
- `params()` or `fields()` called after `use()`.
- `c.redirect(route)` needs a route without parameters; use `route.url({ params })`.
- A route's `Form`, `issues()`, and `url()` need the route's `params` when its pattern has them.
- A component's `Context` has no `redirect`, `cookie.set`, or other way to answer, since the response has started by the time it runs. Calling a form's `Field` as a function is a type error too.
- `route.describe()` needs text that is not blank, takes `destructive` and `idempotent` only on a route that writes, and needs a pattern without both a `:wildcard` parameter and a `*` wildcard.
- A date or time field's `min()` and `max()` must be written as its picker writes a value.
- `new Table()` needs a name, and `default` lists its own columns. A column that may be left out, with `optional()` or `nullish()`, is a type error; use `nullable()` or the `default` option.
- `new Auth()` needs `Auth.tables` and its users table in its database, and `new Limiter()` needs `Limiter.table`.
- An Auth `page`, `redirect`, or `consent` path, and an MCP endpoint `path`, must be a local path of the app's own.

Checks stay at runtime where a type cannot see the value: options read from the environment, values from requests, files, or the database, and mistakes that would open a hole for an attacker, such as calling `sql` with a string instead of a template. Numbers in options are not checked, so one read from the environment needs to be a number that makes sense.
