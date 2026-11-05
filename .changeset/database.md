---
"ovr": minor
---

Add `Table` and `Database` for Postgres: tables defined with schemas or form fields, `database.sql` queries with bound parameters and validated rows, transactions by passing `database.sql` a callback, SQL migrations with checksums and locking, with the migrations of library tables such as `Auth.tables` applied first, in the order each library lists them, and `database.check()` for a basic compatibility check of the live database's columns, and of the foreign keys library tables need, such as Auth's to the users table. Applications supply a pg-compatible pool. `Database.unique(error, constraint)` recognizes unique violations, for example to show them as form errors.

Store schemas as inspectable definitions available through `schema.def`. Add `Schema.date()` and `.uuid()`.
