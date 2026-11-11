---
"ovr": major
---

Only a GET route's form fills its fields from search params of the same name. Other forms restore just the values they persisted in `_form`, so a link such as `/account/edit?role=admin` can no longer fill in a form, its hidden and password fields included, over the `values` passed to it.
