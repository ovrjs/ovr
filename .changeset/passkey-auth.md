---
"ovr": minor
---

Add passkey authentication, mounted with `app.use(auth)`, with registration, login, logout, revocable sessions read with `c.session()` that renew while used, up to their `lifetime`, and customizable forms, creating accounts in the application's users table, stored in the application's Postgres database through `Auth.tables`, whose versioned migrations `database.migrate` applies before the application's. Default to `/login` for the combined login and account creation page. Support signing-secret rotation, accepting a signature only in the spelling it was issued in, and bind registration fields to stored challenges. Browsers without WebAuthn's JSON helpers are told passkeys are unavailable before any challenge is requested.

Limit sign-in per client with fixed limits, and outstanding ceremonies per browser. Add `Limiter` rate limiting for your own routes, stored in Postgres, each limiter named by its first argument, with buckets stored under a hash of their name, policy, scope, and identity. `Limiter.Context` includes `session`, so a `key` can count each signed-in user. An unavailable limiter throws to the app instead of admitting the request. Add trusted client IP support through `App.fetch`.

Use native Base64 and WebAuthn JSON APIs. ovr supports only the latest Node.js LTS release and current browsers; the runtime support policy is documented without a package `engines` restriction.
