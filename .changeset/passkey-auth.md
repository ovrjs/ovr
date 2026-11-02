---
"ovr": minor
---

Add passkey authentication with registration, login, logout, revocable sessions, and customizable forms, stored in the application's Postgres database through `Auth.tables`. Default to `/login` for the combined login and account creation page. Support signing-secret rotation and bind registration fields to stored challenges. Add `Limiter` rate limiting stored in Postgres, configurable in Auth with `limits` policy options, and trusted client IP support through `App.fetch`.

Use native Base64 and WebAuthn JSON APIs. ovr supports only the latest Node.js LTS release and current browsers; the runtime support policy is documented without a package `engines` restriction.
