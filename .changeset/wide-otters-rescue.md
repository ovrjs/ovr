---
"ovr": major
---

refactor(app)!: Merge `App.add` and `App.on/get/post` with `App.use`.

`App.use` is now the single way to add middleware and routes to an app. Routes are now exclusively created using the `Route` class and then added to the app.

```ts
import { App, type Middleware, Route } from "ovr";

const app = new App();

const mw: Middleware = (c, next) => {
	console.log(c.req.method);
	return next();
};

const route = Route.get("/", () => "hello world");

app.use(mw, route);
```

```diff
- app.get("/", () => {});
+ app.use(Route.get("/", () => {}));
```
