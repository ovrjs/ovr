---
"ovr": patch
---

Improve parallel rendering performance by scheduling generator reads through a settled-result queue instead of repeatedly racing every active child. Compiled Vitest benchmarks on Node 26 render 10 sibling elements 1.6x faster, 100 sibling elements 3.8x faster, and 500 sibling elements 13x faster.
