---
"ovr": minor
---

`auth.forms(c)` has an `Add` form that adds another passkey to the account signed in, such as for a second device or one that replaces a lost device. It asks for a passkey for the same account, skips an authenticator that already holds one of the account's, and returns to the page it is on. The docs show how to remove a passkey and how to sign a user in once at a new origin so they can add one there.
