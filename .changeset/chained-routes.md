---
"ovr": major
---

Routes are defined with a chain. `Route.get(pattern)`, `Route.post(pattern)` and `new Route(method, pattern)` take no middleware; add it with `route.use(...middleware)`, and form fields with `route.fields(shape)`:

```ts
// before
const create = Route.post("/posts", { title }, handler);

// after
const create = Route.post("/posts").fields({ title }).use(handler);
```

Each step returns the route. `route.params(schemas)` checks and converts pattern parameters before the middleware runs, types `c.params` with the converted values, and responds 404 when one fails. `route.describe(text)` describes the route for AI agents, and `describe(false)` hides it. `Route.post(pattern)` requires a pattern, the generated hash patterns are removed.

`route.middleware` is read-only; add middleware with `use`. A route with fields renders its fields and submit button in `Form` by default whenever `fields` is called.
