---
"ovr": minor
---

- A passkey has what tells it apart in a list: `created`, the `origin` it was made at, and a `name`, which the `Add` form takes as an optional field.
- `auth.link(user, { origin })` makes a link that signs a user in once, for five minutes, for an origin where they have no passkey or after losing their device. It opens the authentication `page`, where `<Link />` from `auth.forms(c)` is the button that signs them in. Only the link's hash is stored, in the new `auth_links` table.
