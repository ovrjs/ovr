---
"ovr": patch
---

Improve rendering and multipart parsing performance:

- Forward already-rendered HTML chunks directly from generators, avoiding redundant Render instances and async iterator delegation. A benchmark rendering 500 sibling JSX elements took about **19% less time** (1.34 → 1.08 ms).
- Compact the multipart buffer only when more space is needed, avoiding repeated copies of unread bytes after each delimiter. Parsing 1,000 × 1 KiB fields received in 1 MiB chunks took about **54% less time** (26.8 → 12.4 ms), or **2.15× throughput**.

These are local Node 24.19.0 benchmark results; gains depend on the workload.
