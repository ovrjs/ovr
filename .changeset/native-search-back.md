---
"ovr": patch
---

The multipart parser uses its own boundary search again on every runtime. The last release used Node's `Buffer.prototype.indexOf` on Node only, which made the parser behave differently by runtime.
