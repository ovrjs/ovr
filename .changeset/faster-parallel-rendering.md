---
"ovr": patch
---

Improve parallel rendering performance by scheduling generator reads through a settled-result queue instead of repeatedly racing every active child. Compiled Vitest benchmarks render 10 sibling elements 2.4x faster and 100 sibling elements 11x faster.
