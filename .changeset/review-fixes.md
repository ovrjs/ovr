---
"ovr": major
---

Fixes and changes to existing behavior:

- **`Render` is `Html`:** it renders HTML, next to `Markdown`, which renders the same elements to Markdown. `Render.html` is `Html.raw`, `Render.Options` is `Html.Options`, and `Render.Chunk` is `Html.Chunk`. A chunk's `value` is its text before escaping, or its HTML when `safe`, and `toString()` returns its HTML.
- **Trailing slash:** a request no route matches is redirected only when the other spelling of its path matches a route. A matched route always answers, so its handler no longer runs and is then replaced by a redirect.
- **Routes:** `route.url()` fills parameters and wildcards anywhere in a segment, such as `/file-:id` and `/files-*`. It throws for a parameter that would leave its segment, empty, `.`, or `..`, and when a value would make the path start with `//`, which browsers read as another host.
- **Responses:** a returned `Response` keeps each of its `Set-Cookie` headers, added to cookies already set. Content returned with a `Content-Type` such as `Text/HTML` or `text/html ; charset=utf-8` is escaped as markup, since media types ignore case and spaces. `Html.string(element)` is static, like `Html.stream`.
- **Rendering:** a chunk rendered while an earlier sibling is still rendering is no longer changed, so an `Html.raw()` value used in more than one place renders the same each time.
- **Multipart:**
  - The parser skips the rest of a part its reader stopped reading, so a file's bytes are never parsed as further fields.
  - A part that ends without its boundary, a body without the closing delimiter, and one without an opening boundary throw `TypeError`. A form without fields, only the closing delimiter, still parses.
  - Only a delimiter starting the body or a line opens the first part, a line in a part that starts with the boundary rejects the body, as RFC 2046 does not allow it, and nothing after the closing delimiter is parsed. Spaces and tabs after a delimiter are ignored, as RFC 2046 requires of receivers.
  - Boundaries must be 1 to 70 RFC 2046 characters; a boundary of 252 or more characters made parsing loop forever. Boundary searches are linear whatever boundary the client chooses.
  - Quoted header parameters can contain `;` and escaped quotes, and decode only `%22`, `%0D`, and `%0A`, the escapes browsers write in filenames, so a file named `100%41.txt` keeps its name. Field names and filenames keep the UTF-8 browsers send, such as `レポート.pdf`, and a part header that is not UTF-8 throws `TypeError`.
- **Forms:** a route's `Form` renders its fields, if any, and a submit button labelled with `submit`, so one without fields, such as a delete, is no longer empty; children replace both. Radio, select, checkbox, and multiselect fields say "Select an option" when nothing or an option that is not offered is sent, instead of "Required field". Field names such as `constructor` are unexpected fields, not inherited properties.
- **Schemas:** a `__proto__` key is kept as data, in an object's shape, passed through by `loose()`, or named by `pick` or `omit`, instead of changing the parsed object's prototype. Unions and arrays with very many issues no longer overflow the stack.
