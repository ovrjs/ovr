---
"ovr": minor
---

`Table` and `Database`, for Postgres. Apps supply a pg-compatible pool.

```ts
const posts = new Table("posts", {
	id: Schema.string().uuid(),
	title: Field.text(),
});
const database = new Database(pool, [posts]);

const rows = await database.sql`SELECT * FROM ${database.posts}`.parse(
	database.posts,
);
```

- **Tables** are defined with schemas or form fields, so a table's field carries its label, description, and constraints into every form and tool that uses it.
- **Queries:** `database.sql` queries with bound parameters, and `parse(table)` validates the rows. `sql.values(table, row)` and `sql.set(table, updates)` write a row. `Database.Query` names a query's type.
- **Constraint errors:** `Database.unique(error, constraint)` recognizes a unique violation from pg or Bun, such as to show it on a field.
- **Transactions:** pass `database.sql` a callback.
- **Migrations:** `database.migrate(migrations)` applies SQL migrations with checksums and locking, each in a transaction with its history record. The migrations of library tables such as `Auth.tables` are applied first.
- **Checks:** `database.check()` compares the live database's columns with the tables.
