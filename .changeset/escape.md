---
"ovr": minor
---

`Render.escape` takes the text by where it goes, and escapes Markdown too: `Render.escape({ html })` for an element's content, `Render.escape({ attr })` for an attribute's value, where it was `Render.escape(text, true)`, and `Render.escape({ markdown })`, for text put into the Markdown `Render.raw` is given.
