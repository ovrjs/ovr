---
"ovr": minor
---

`Tester`, from `ovr/test`, tests an app as a signed-in person and as their agent, without a browser, a passkey, or an agent.

```ts
import { Tester } from "ovr/test";

const ross = new Tester({ app, user: "user-1" });

// as the person: the route's own request, signed in
const saved = await ross.fetch(create, { data: { title: "Chili" } });

// as their agent: a tool call through the MCP endpoint
const result = await ross.call(create, { title: "Chili" });
```

`fetch` sends a form's fields as its form does and keeps the cookies the app sets. `call` returns the tool's result. Leave `user` out for a visitor who is signed out.
