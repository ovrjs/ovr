---
"ovr": patch
---

A `Limiter` used as global middleware counts an agent's tool call once. It was counted twice, for the request to the MCP endpoint and again for the endpoint's own request to the route, so agents had half the limit.
