---
"ovr": minor
---

`Field.unique(message)` marks a public value no two users share, such as a username. Registration checks a users table's `unique()` fields before the passkey prompt and shows the message on the field when the value is taken. Other conflicts, such as an email's, stay generic.
