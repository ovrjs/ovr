---
"ovr": patch
---

Importing one export bundles less of the rest. `Field` is about 10 KB smaller minified, `Form` 9 KB, `Route` 8.6 KB, `Mcp` 7 KB, `Auth` 5 KB, and `App` 2 KB. Class statics that ran code as a module loaded kept whole classes in a bundle that never used them, such as `Form` and the multipart parser in one that only imports `Field`.
