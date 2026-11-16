---
"ovr": patch
---

`Render.raw` with one line of `markdown` stays in its line, such as a separator only agents read, `Render.raw({ markdown: " · " })`, inside a list item. It was always its own block, which broke the line apart anywhere but a paragraph. Markdown of several lines, or whose HTML starts with a block element, is still its own block.
