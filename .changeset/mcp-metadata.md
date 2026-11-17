---
"ovr": minor
---

An MCP endpoint says what the app is, a tool says when it is safe to retry, and a route knows which agent is calling.

```ts
new Mcp({ name: "posts", title: "Posts", version: "2.3.0", websiteUrl, icons });

Route.post("/posts/:id").describe("Change a post", { idempotent: true });

const session = await c.session();
session?.agent; // { id, name } for an agent's call, undefined for a person's
```

- `Mcp` takes `title`, `version`, `description`, `websiteUrl`, and `icons`, sent as the server's info. The version was always `1.0.0`, which is still the default.
- `describe` takes `idempotent: true` for a route that leaves the same result when called again with the same arguments. It is sent as `idempotentHint`, which a tool that reads always has.
- A session made for an agent's tool call has `agent`: its client ID, which `auth.disconnect` takes, and the name it gave itself. An app can keep its own log of what each agent did.
