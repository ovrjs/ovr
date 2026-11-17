---
"ovr": patch
---

A route's own `Form` renders the route's fields again, so the shortest form needs no `const`: `<add.Form submit="Add" />`. It is the same for every request. The form that shows what a refused submission sent is still `route.form(c)`.
