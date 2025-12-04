---
"ovr": major
---

refactor!: The same `Route` class is now used within the router and app. `Route` can now be used to create a route with any method.

BREAKING CHANGES:

- Makes router `Trie` class private
- `Get` and `Post` helpers are now `Route.get` and `Route.post` respectively.
- POST Route components (`<Form>`/`<Button>`) default to set `enctype=multipart/form-data`

```diff
- import { Get, Post } from "ovr";
+ import { Route } from "ovr";

- const page = new Get("/", () => {})
+ const page = Route.get("/", () => {})

- const post = new Post(() => {})
+ const post = Route.post(() => {})

+ const route = new Route("DELETE", "/delete", () => {})
```
