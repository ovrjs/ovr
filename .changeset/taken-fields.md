---
"ovr": minor
---

`Field.taken(message)` is what to say when a user already has a public value no two users share, such as a username. Registration checks a users table's `taken()` fields before the passkey prompt and shows the message on the field. Other conflicts, such as an email's, stay generic.
