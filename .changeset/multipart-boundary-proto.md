---
"ovr": patch
---

Reject multipart boundaries that are not 1 to 70 RFC 2046 characters. A boundary of 252 or more characters made parsing loop forever.

Object schemas keep a `__proto__` key as data, in the shape or passed through by `loose()`, instead of changing the parsed object's prototype.
