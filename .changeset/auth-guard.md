---
"ovr": minor
---

`auth.guard` wraps a route that needs someone signed in.

```tsx
Route.get("/recipes").use(auth.guard(() => <Book />));

Route.post("/recipes").use(
	auth.guard(async (c) => {
		const { user } = await c.session(); // never null here
	}),
);
```

Anyone else is redirected to the authentication `page`, and comes back once they sign in: to the page they asked for, or to the page the form they sent was on.
