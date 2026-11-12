---
"ovr": patch
---

- A table that lays out a list's rows is left out of the page an agent reads through MCP, since the tool's form already lists the items as the array it takes. In a table that is kept, a checkbox says when it is checked and a select shows the option chosen.
- A row's control from `component` is no longer read with a description it may not render. The default layout, which renders each cell's description, still is.
- An issue of a row that is not shown again, in a list that is not persisted or has too many rows to keep, is shown under the list and says where it was, such as "Row 2, name: Required field".
- `min()` and `max()` say "At least 2" and "At most 7", and "At most 80 characters" for text, instead of "Expected maximum 7".
