---
"ovr": patch
---

On an MCP endpoint's own request, `c.session()` returns the session of the agent's token, as it does in the tool calls the endpoint makes. Global middleware that reads the session there, such as a `Limiter` keyed by user, found nobody signed in and threw. A token is still a session only on the endpoint it was issued for.
