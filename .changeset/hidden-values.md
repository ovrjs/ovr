---
"ovr": patch
---

Forms at one address are told apart by their hidden values.

A page of rows that each post to the same route with the same parameters, and differ only by a hidden field such as the row's ID, showed a refused submission in every row. A form given a hidden field's value in `values` now shows only a refusal that was sent with that value.
