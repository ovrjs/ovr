---
"ovr": patch
---

Improve route matching performance by traversing the trie with pathname offsets instead of allocating a new substring for each node. Compiled Vitest benchmarks on Node 26 measure direct trie matching approximately 7–8% faster.
