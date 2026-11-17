---
"ovr": patch
---

A route's form keeps less of its own state, and the docs describe forms and sessions as they are now.

- The route's own `Form` is its bound form's, with no registry between them, and a form's fields read what a request kept through one function.
- `auth.guard` uses the form's own `_return` name and the shared method names.
- Docs: the `state` and `values` props are gone from the route page, examples that need someone signed in use `auth.guard`, and `Context.Session` is named.
