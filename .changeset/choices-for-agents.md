---
"ovr": patch
---

- Choices given as a page renders, from a field made with a schema such as `Field.checkboxes(Schema.string().uuid())`, are listed under the form's tool when an agent reads the page through MCP, since the tool's input schema can't hold them.
- A field's description keeps its last period in the tool's input schema. When it is joined with more, such as a date's format or a file's guidance, the whole description ends as a sentence.
- The package includes `CHANGELOG.md`.
