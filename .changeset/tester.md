---
"ovr": minor
---

`Tester`, from `ovr/test`, tests an app as a signed-in person and as their agent, without a browser, a passkey, or an agent.

```ts
import { Tester } from "ovr/test";

const ross = new Tester({ app, auth, user: "user-1" });

// as the person: the route's own request, signed in
const saved = await ross.fetch(create, { data: { title: "Chili" } });

// as their agent: a tool call through the MCP endpoint
const result = await ross.call(create, { title: "Chili" });
```

`fetch` sends a form's fields as its form does, a list as rows and a file as a `File`, and keeps the cookies the app sets. `call` returns the tool's result, and throws when the endpoint refuses the request. Run tests against a database of their own: signing in and connecting the agent write real rows.

`route.state(url)` reads what a URL holds for the route's form after a refused submission: its issues, and the values kept. Use it in a test, or on a page to open the `<details>` a form is in instead of reading `_form` yourself:

```tsx
<details open={Boolean(create.state(c.url)?.issues)}>
```
