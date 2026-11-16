---
"ovr": minor
---

A route's `Form` gives an agent in the browser more of what the MCP endpoint does:

- `tooltitle`, the tool's title, which `route.tool.title` now holds.
- `toolparamdescription` on a field's control when the field has a description, its label and description, and on each cell of a list, which has no label of its own. Chrome otherwise describes an argument with its label alone, and a list's cell with nothing.
