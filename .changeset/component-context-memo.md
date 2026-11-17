---
"ovr": minor
---

A component is given the request's context as its second argument, and `c.memo` shares a function's result for the request.

```tsx
const friendsOf = (user: string) => sql`...`.parse(friends);

async function Share(props: { user: string }, c: Middleware.Context) {
	const friends = await c.memo(friendsOf)(props.user);
}

<Share user={session.user} />;
```

- A page no longer passes `c` down to the components that need it. A render made on its own, outside of a request, has no context to give.
- `c.memo(fn)` returns `fn`, run once for each set of arguments for the rest of the request, compared as `===` does. Components that each read the same rows query once, and the route shares the same results through its own `c`.
