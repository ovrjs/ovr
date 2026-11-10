---
"ovr": patch
---

Markdown keeps more of a page:

- A form in a table's cell is kept. One that is only a button, such as a delete in each row, is written in the cell, and one with fields after the table. It was left out.
- An inline element that holds blocks, such as a custom element around a card, is read as a container, so its headings, lists, code, and forms are kept. A code block in a `<dd>` or `<figcaption>` keeps its lines.
- Raw markup is its own block only when it starts with a block element, so `Markup.raw("&euro;")` stays in its sentence.
- A list keeps items inside a wrapper element and a list placed directly in a list, and paragraphs in one item stay apart.
- A button with a `formaction` says where it submits.
