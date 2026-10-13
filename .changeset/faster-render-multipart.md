---
"ovr": patch
---

Improve rendering and multipart parsing performance:

- Forward already-rendered HTML chunks directly from generators, avoiding redundant Render instances and async iterator delegation. A benchmark rendering 500 sibling JSX elements took about **19% less time** (1.34 → 1.08 ms).
- Compact the multipart buffer only when more space is needed, avoiding repeated copies of unread bytes after each delimiter. Parsing 1,000 × 1 KiB fields received in 1 MiB chunks took about **54% less time** (26.8 → 12.4 ms), or **2.15× throughput**.
- Scan incoming file bytes directly, copying output into independent storage or a BYOB destination and preserving unread bytes before yielding control. This retains Request parts and byte-stream behavior. Consuming a 10 MiB file with a reusable 64 KiB BYOB destination took about **39% less time** than the compaction-only version (3.30 → 2.02 ms), averaged across forward and reverse parser orders. Default-reader timings varied between runs; the field workload was roughly unchanged.

These are local Node 24.19.0 benchmark results; gains depend on the workload.
