---
"ovr": patch
---

A response to a browser that sends the session cookie is `Cache-Control: no-store` before its route runs.

Reading the session set the header, which a component that read it while the page streamed was too late to do: after its first `await`, the page went out without it. Nothing is looked up, a visitor's responses are as they were, and a route that reads no session can still set its own `Cache-Control`.
