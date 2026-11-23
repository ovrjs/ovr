---
"ovr": patch
---

- `register.Form` takes a function child given `Field` and `Fields`, as a route's form does. `register.Field` and `register.Fields` are removed.
- `auth.logout(c)` resolves nothing instead of `null`.
- A `Limiter`'s `key` is given `req`, `url`, `ip`, and `session`, without `res` or `cookie`.
- `Auth.Credential` is removed. A passkey row is `Schema.Infer` of `Auth.tables`' `auth_credentials`.
- `Multipart.Options` takes `undefined` for `memory` and `payload`, as it does for `parts`.
