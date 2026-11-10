---
"ovr": patch
---

Form submissions work on servers that pass their own request object, such as srvx. `Multipart` copied the request with the platform's constructor, which only accepts its own requests, so `c.data()` threw on every POST there.
