---
"ovr": minor
---

Add passkey authentication, mounted with `app.use(auth)`, with registration, login, logout, revocable sessions read with `auth.session`, and customizable forms, stored in the application's Postgres database through `Auth.tables`, created by the versioned migration SQL in `Auth.sql`. Default to `/login` for the combined login and account creation page. Support signing-secret rotation and bind registration fields to stored challenges. Add `Limiter` rate limiting stored in Postgres, configurable in Auth with `limits` policy options, and trusted client IP support through `App.fetch`.

Use native Base64 and WebAuthn JSON APIs. ovr supports only the latest Node.js LTS release and current browsers; the runtime support policy is documented without a package `engines` restriction.
