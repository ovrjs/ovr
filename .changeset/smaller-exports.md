---
"ovr": patch
---

Importing one export bundles less of the rest. `Field` is about 10 KB smaller minified, `Route` 8.6 KB, `Mcp` 7 KB, `Auth` 5 KB, and `App` 2 KB. Class statics that ran code as a module loaded kept whole classes in a bundle that never used them, such as the form and multipart parsers in one that only imports `Field`.
