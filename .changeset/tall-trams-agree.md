---
"ovr": minor
---

feat(Cookie): Adds `Context.cookie` class to easily get cookies from the current request headers, and set them on the response.

```ts
import { Route } from "ovr";

const route = Route.get("/", (c) => {
	c.cookie.get(name);
	c.cookie.set(name, value, options);
});
```
