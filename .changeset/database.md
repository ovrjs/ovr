---
"ovr": minor
---

Add `Table` and `Database` for Postgres: tables defined with schemas, `db.sql` queries with bound parameters and validated rows, transactions, SQL migrations with checksums and locking, and `db.check()` to verify the live database can store the tables' rows. Applications supply a pg-compatible pool.

Store schemas as inspectable definitions available through `schema.def`. Add `Schema.date()` and `.uuid()`.
