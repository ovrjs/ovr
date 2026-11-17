---
"ovr": minor
---

`route.tool.name()` is a function, and `describe`'s function takes no argument.

```ts
const publish = Route.post("/posts/:id/publish").describe(
	() => `Publish a post. To undo it, call ${unpublish.tool.name()}.`,
);
```

- `route.tool.name()` gives a route's tool name anywhere, as `route.url()` gives its address. It was the property `route.tool.name`.
- `route.tool` always exists. For a route with no description, which is no tool, `name()`, `title`, and `description` throw, where `route.tool` was `undefined`.
- The function `describe` takes is given nothing: read the name from the route. It replaces `(tool) => ... tool(route)` from the last release.
