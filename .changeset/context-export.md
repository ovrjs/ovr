---
"ovr": minor
---

`Context` is exported, and a render takes the `context` to give its components.

```tsx
import { type Context, Render } from "ovr";

function NavLink(props: { href: string }, c: Context) {}

const html = await new Render({ markup: <Page /> }, { context: c }).string();
```

- `Middleware.Context` is removed: import `Context`. `Middleware.Context.Cookie.Options` is `Context.Cookie.Options`.
- A render of Markdown that is given a `context` resolves links against the request's URL, unless `base` is given.
