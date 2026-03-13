---
"ovr": minor
---

feat: Redirect directly to a `Route` instead of having to call `Route.pathname()`

```tsx
import { Route } from "ovr";

const form = Route.get("/signup", () => {
	// ...
});

const redirect = Route.post((c) =>
	c.redirect(
		form, // redirect to the route directly
		303,
	),
);
```
