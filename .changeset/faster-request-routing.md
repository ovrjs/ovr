---
"ovr": patch
---

Improve server request routing by passing an incoming `Request` directly when no `RequestInit` overrides are supplied instead of cloning it. Compiled Vitest benchmarks on Node 26 measure 1.5x higher throughput (about 34% lower latency) across a 12-request routing workload.
