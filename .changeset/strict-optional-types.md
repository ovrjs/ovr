---
"ovr": patch
---

Improve TypeScript 7 compatibility by accurately typing optional values forwarded internally with `exactOptionalPropertyTypes`. Optional properties remain omittable and now also accept an explicitly forwarded `undefined` where supported.
