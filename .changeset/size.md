---
"ovr": patch
---

The bundle is about 6 KB smaller minified, 124 KB from 130 KB, from code that was written more than once now living in one place, across Auth, the MCP endpoint, the Markdown writer, forms, the database helpers, and request handling. Importing one export bundles less of the rest: `Field` is about 10 KB smaller, `Route` 8.6 KB, `Mcp` 7 KB, `Auth` 5 KB, and `App` 2 KB. Class statics that ran code as a module loaded kept whole classes in a bundle that never used them, such as the form and multipart parsers in one that only imports `Field`. Behaviour, output, and messages people and agents see are unchanged.
