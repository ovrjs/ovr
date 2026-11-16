---
"ovr": minor
---

`Render` is the one export for rendering, in place of `Markup` and `Markdown`:

- `Render.raw({ markup, markdown })` writes what is already rendered, for `Markup.raw(html)` and `Markdown.raw(markdown, html)`. With only `markup`, agents get it too; with only `markdown`, the page shows nothing; and an empty `markdown` hides the markup from agents.
- `new Render({ markup: element }, options)` and `new Render({ markdown: element }, options)` are a render, an async iterable with `stream()` and `string()`, for `new Markup(element)`, `Markup.stream(element)`, `Markup.string(element)`, and the same of `Markdown`.
- `Render.escape({ markup: text })` for `Markup.escape(text)`.
- The types are `Render.Chunk`, `Render.Options.Markup`, and `Render.Options.Markdown`.
- `c.markdown(body)` for `c.md(body)`.
