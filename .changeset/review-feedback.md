---
"ovr": patch
---

`describe` takes its options only on a route that writes, and `auth.guard` redirects to an absolute address.

- `Route.get(...).describe("...", { destructive: false })` is a type error: a route that reads is never destructive, so the option did nothing there.
- `auth.guard`'s redirect to the authentication page is an absolute URL, as the redirect of a refused form is, so a test compares the two the same way.
