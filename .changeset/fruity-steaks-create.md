---
"ovr": patch
---

fix: refactor `route.Params` into a helper type to extract the params.

This fixes an issue where `route.Params` was interpreted as a runtime property instead of a type.

```diff
import { Route } from "ovr";

const page = Route.get("/:name", (c) => c.params.name);

- type PageParams = typeof page.Params;
+ type PageParams = Route.Params<typeof page>;
```
