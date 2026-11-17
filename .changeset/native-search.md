---
"ovr": patch
---

A multipart body is parsed about twice as fast on Node for large files.

On Node the parser finds each boundary with `Buffer.prototype.indexOf`, read from the global so nothing imports `node:`, where there is at least 8 KB to search. A 100 MB file in 64 KB chunks parses in about half the time. Smaller searches, and Deno, Bun, and Workers, keep the parser's own search, since the native one is slower there.
