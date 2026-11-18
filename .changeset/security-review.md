---
"ovr": patch
---

Fixes from a security review:

- A cookie's value ends at its `;`, so a quote in one cookie cannot take in the session cookie after it.
- A refused submission is kept in the `__Host-form` cookie, which only the app's own host can set, at `Path=/`, so a `;` in the page's path cannot add attributes to it.
- A field that takes any number of values, such as `Field.file().multiple()`, `lines()` and `checkboxes` of a schema, takes at most 1000, and `Multipart` takes at most 1000 parts by default, so a body of many tiny parts is refused before it is read.
- A multipart limit set to `undefined` or `NaN`, such as from an unset environment variable, keeps its default instead of turning the limit off.
- An MCP write that redirects with 307 or 308 is followed only to another tool.
- `auth.remove(c, id)` signs the user out everywhere else.
- In a page's Markdown, a submit input's value, a field's rule values and a code block's language are escaped.
- A number field takes only decimal text, and spaces alone are empty.
