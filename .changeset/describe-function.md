---
"ovr": minor
---

`describe` takes a function, to name another route's tool in a description.

```ts
const publish = Route.post("/posts/:id/publish").describe(
	(tool) => `Publish a post. To undo it, call ${tool(unpublish)}.`,
);
```

A description is a string, written as its module loads, so two routes that named each other's tools could not both come first, and across modules it was an import cycle. The function is called once every route exists. `tool(route)` gives the route's tool name, so a renamed route updates every description that names it, and naming a route with no description is an error as the app starts.
