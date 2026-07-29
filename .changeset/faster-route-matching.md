---
"ovr": patch
---

Improve route matching performance by traversing the trie with pathname offsets instead of allocating a new substring for each node. Compiled Vitest benchmarks measure direct trie matching approximately 9–13% faster.
