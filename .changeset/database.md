---
"ovr": minor
---

Add `Table` and `Database` for Postgres:

- **Tables** are defined with schemas or form fields. Dates inside JSON columns are stored as ISO strings and read back as dates, in union branches too.
- **Queries:** `database.sql` queries with bound parameters and validated rows. `Database.unique(error, constraint)` recognizes unique violations, for example to show them as form errors.
- **Transactions:** pass `database.sql` a callback. Queries the callback did not wait for finish before the commit, so one that fails rolls the transaction back.
- **Migrations:** SQL migrations with checksums and locking, each committed with its history record in one transaction, so `BEGIN`, `COMMIT`, and `ROLLBACK` are not allowed in them. The migrations of library tables such as `Auth.tables` are applied first, in the order each library lists them.
- **Checks:** `database.check()` is a basic compatibility check of the live database's columns, and of the foreign keys library tables need, such as Auth's to the users table.

Applications supply a pg-compatible pool.
