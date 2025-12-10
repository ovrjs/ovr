---
"ovr": major
---

remove!: Remove `Context.page`, `Context.head`, `Context.layouts`, and `Context.base`

BREAKING CHANGES: ovr now expects the full page to be returned from each handler. This makes ovr more type safe and prevents bugs like forgetting to set the `head` elements on a page. Now wrap each page in a `Layout` component.
