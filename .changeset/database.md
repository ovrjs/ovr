---
"ovr": minor
---

Add `Table` and `Database` for Postgres: tables defined with schemas or form fields, `db.sql` queries with bound parameters and validated rows, transactions, SQL migrations with checksums and locking, and `db.check()` for a basic compatibility check of the live database's columns. Applications supply a pg-compatible pool.

Store schemas as inspectable definitions available through `schema.def`. Add `Schema.date()` and `.uuid()`.
