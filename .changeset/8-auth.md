---
"ovr": minor
---

Passkey authentication and rate limiting, stored in the application's Postgres database.

- **Auth:** mounted with `app.use(auth)`, with registration, login, logout, revocable sessions read with `c.session()` that renew while used, up to their `lifetime`, and customizable forms whose message parts are `Register.Issue` and `Login.Issue`, as a field's is its `Issue`. Accounts are created in the application's users table, and Auth's own tables come from `Auth.tables`, whose versioned migrations `database.migrate` applies before the application's. `/login` is the default combined login and account creation page, and `/login?_return=/path` brings the user back to a path of your own after they sign in.
- **Ceremonies:** registration fields are bound to stored challenges, and outstanding ceremonies are limited per browser. Browsers without WebAuthn's JSON helpers are told passkeys are unavailable before any challenge is requested. Signing secrets rotate, and a signature is accepted only in the spelling it was issued in.
- **Limits:** sign-in is limited per client with fixed limits. `Limiter` rate limits your own routes, each limiter named by its first argument, with buckets stored under a hash of their name, policy, scope, and identity. `Limiter.Context` includes `session`, so a `key` can count each signed-in user. An unavailable limiter throws to the app instead of admitting the request.
- **Client IP:** `App.fetch` takes the trusted client IP from the server.
