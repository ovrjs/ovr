---
"ovr": patch
---

An MCP endpoint runs outside the app's global middleware. It is the way in for agents, not a page of the app, and the request it makes to a route for each tool call or resource read passes through global middleware once, as the agent's user. Middleware ran twice for each call before, on the endpoint's request and on the route's, so a `Limiter` passed to `app.use` counted each call twice, and middleware that read the session found nobody signed in on the first.

A write that redirects is done: when the page it redirects to cannot be read, such as on a rate limit, the tool result says so without being an error, so an agent does not repeat the write. A refused request's `Retry-After` is included in what the agent receives.
