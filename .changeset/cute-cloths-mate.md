---
"ovr": minor
---

feat: HEAD Request handling

ovr now automatically handles [`HEAD`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/HEAD) requests, each will be routed to the corresponding `GET` route. Middleware will execute but `Context.res.body` will cleaned up and set to `null` before building the final response.
