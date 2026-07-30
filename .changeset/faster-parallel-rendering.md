---
"ovr": patch
---

Improve parallel rendering performance by scheduling generator reads through a settled-result queue instead of repeatedly racing every active child. Compiled Vitest benchmarks on Node 26 render 10 sibling elements 1.6x faster, 100 sibling elements 3.8x faster, and 500 sibling elements 13x faster.

Removing redundant promise wrapping and completed-generator cleanup improves the settled-result queue by another 1.1x with 10 or 100 siblings and 1.13x with 500 siblings. Returning fragment children directly makes a 100-fragment render 1.28x faster, while a mixed 500-component render improves 1.06x.
