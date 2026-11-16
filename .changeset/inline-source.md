---
"ovr": patch
---

`Markdown.raw(markdown, html)` with one line of source stays in its line, such as a separator only agents read, `Markdown.raw(" · ", "")`, inside a list item. It was always its own block, which broke the line apart anywhere but a paragraph. Source of several lines, or whose HTML starts with a block element, is still its own block.
