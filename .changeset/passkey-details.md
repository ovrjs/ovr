---
"ovr": minor
---

- A passkey has what tells it apart in a list: `created`, the `origin` it was made at, and a `name`, which the `Add` form takes as an optional field.
- `auth.link(user, { origin, minutes })` makes a link that signs a user in once, for an origin where they have no passkey or after losing their device. It opens the authentication `page`, where `<Link />` from `auth.forms(c)` is the button that signs them in. Only the link's hash is stored, in the new `auth_links` table.
- `auth:1` changed for these, since v7 is not released: `auth_credentials` has three more columns and `auth_links` is new. A database migrated with an earlier prerelease needs the same changes made by hand, and the migration's checksum updated.
