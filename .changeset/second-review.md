---
"ovr": patch
---

Fixes from a second security review:

- A list counts at most one part a cell for each of its rows, so an open-ended cell, such as `checkboxes` of a schema, does not multiply the 1000.
- A form's parts stay within the app's own `multipart.parts`.
- A streamed file is checked by its name and type, such as with `accept()`, before its body is read, one left empty is missing, and `result.stream` holds only the parts of streamed fields that pass.
- The passkey script resolves its URLs against the page's own address, not a `<base>` added to the page, and its `src` is a whole URL. A submission that validation stops clears the signed passkey.
- `auth.remove(c, id)` also disconnects the user's agents, and an agent cannot call it or `auth.disconnect`.
- A `javascript:` URL is left out of `formAction`, `HREF` and other spellings of the URL attributes.
- In Markdown, a carriage return ends a line as `\n` does, a field's label is one line, and a submit input that submits elsewhere says where.
- An enum's issue writes its values once, not for each bad value.
- A `Limiter` with a limit under one admits no one.
