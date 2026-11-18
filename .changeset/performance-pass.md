---
"ovr": patch
---

Faster requests, rendering, Markdown, forms and multipart parsing.

- An element whose child is text alone renders as one chunk with its tags, so iterating a render yields `<p>text</p>` whole.
- `c.url` is parsed the first time it is read, and routes are matched from the request's path.
- `App.Mount` has `tools`, the app's tools by name, which the MCP endpoint finds a called tool by.
- A schema's issues have no stack.
- Multipart parts' headers are checked once, and the boundary is searched for from two places at once.
