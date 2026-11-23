---
"ovr": patch
---

`Database.unique()`, Auth's duplicate and deleted-account refusals, and migration errors read the SQLSTATE from `errno` too, where Bun's `PostgresError` puts it.
