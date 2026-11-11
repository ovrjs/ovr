---
"ovr": major
---

`Form` is internal, and `route.fields(shape)` is the one way to give a route fields. A route renders them with `Field`, `Fields`, and `component`, and no longer has the form's `parse`, `shape`, `names`, `parts`, `extend`, `pick`, and `omit`, which `c.data()` and the MCP endpoint use for it. To share fields, reuse the shape object, typed `Field.Shape`. `Form.from()` and `Route.Schema` are removed.
