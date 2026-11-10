---
"ovr": patch
---

An MCP endpoint runs outside the app's global middleware. It is the way in for agents, not a page of the app, and the request it makes to a route for each tool call or resource read passes through global middleware once, as the agent's user. Middleware ran twice for each call before, on the endpoint's request and on the route's, so a `Limiter` passed to `app.use` counted each call twice, and middleware that read the session found nobody signed in on the first.

A write that redirects is done: when the page it redirects to cannot be read, such as on a rate limit, the tool result says so without being an error, so an agent does not repeat the write. A refused request's `Retry-After` is included in what the agent receives.

The endpoints an agent signs in through run outside global middleware too: both metadata documents, `/oauth/authorize`, and `/oauth/token`. A check for a session in global middleware redirected an agent away from them, so it could not sign in. Each still refuses a request for another host itself, and Auth's own limits still apply. The user's approve and deny posts stay the app's requests. The endpoint's protected resource metadata names the endpoint at Auth's configured origin, where it named whatever host the request used.
