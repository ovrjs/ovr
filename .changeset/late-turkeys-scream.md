---
"ovr": major
---

refactor(context)!: Move `body`, `status`, and `headers` into a separate `res` object. Removes the `res` method.

```ts
Route.get("/api/:id", (c) => {
	c.res.body = "# Markdown"; // BodyInit | null | undefined
	c.res.status = 200; // number | undefined
	c.res.headers.set("content-type", "text/markdown; charset=utf-8"); // Headers
});
```
