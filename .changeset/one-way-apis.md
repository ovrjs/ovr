---
"ovr": major
---

- `c.redirect()` takes a URL. For a route, pass `route.url()`, which gives a route with parameters their values: `c.redirect(list, 303)` becomes `c.redirect(list.url(), 303)`.
- `JSX` is exported as a type only. The JSX runtime is `ovr/jsx-runtime`, which TypeScript and bundlers load from `jsxImportSource`.
