---
"ovr": minor
---

A render is made with `new Render`, which takes the element by what to render it to, as `Render.raw` and `Render.escape` take theirs: `new Render({ markup: element }, options)` and `new Render({ markdown: element }, options)`, where they were `Render.markup(element, options)` and `Render.markdown(element, options)`.
