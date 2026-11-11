---
"ovr": minor
---

- `Field.checkboxes()`, `Field.radio()`, and `Field.select()` take a schema that checks each value, such as `Schema.string().uuid()`, as well as a list of options. The options are given as the page renders, as `options` on the field's `Field` or `component`, for choices such as a record's own photos.
- `auth.forms(c)` reads `_return` from the login page's URL, so `/login?_return=/recipes/1` brings the user back there after they register or log in. Only a path of the app's own origin is followed.
- `Markdown.raw(markdown, html)` renders the HTML on pages and the Markdown source for agents reading the page as Markdown.
