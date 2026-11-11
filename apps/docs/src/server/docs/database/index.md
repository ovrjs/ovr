---
title: Database
description: Postgres tables, queries, transactions, and migrations with ovr schemas.
---

`Database` connects ovr to Postgres. Define tables with [schemas](/schema), write queries in SQL, and apply SQL migrations. ovr validates what goes in and comes out, and checks that the live database is compatible with your tables.

## Define tables

Columns are ordinary schemas. A table describes the data your application reads and writes; keys, constraints, indexes, and default expressions belong in [migrations](#migrate). An empty table, column, or schema name, or one with a NUL character, is a type error.

```ts
import { Database, Schema, Table } from "ovr";
import { Pool } from "pg";

const users = new Table(
	"users",
	{
		id: Schema.string().uuid(),
		email: Schema.string().email(),
		name: Schema.string().nullable(),
		created: Schema.date(),
	},
	{ default: ["id", "created"] },
);

const posts = new Table(
	"posts",
	{
		id: Schema.string().uuid(),
		author: Schema.string().uuid(),
		title: Schema.string().min(1).max(200),
		published: Schema.boolean(),
	},
	{ default: ["id", "published"] },
);

export const database = new Database(
	new Pool({ connectionString: process.env.DATABASE_URL }),
	[users, posts],
);
```

| Option    | Value                                                                           |
| --------- | ------------------------------------------------------------------------------- |
| `default` | Columns the database supplies, with a `DEFAULT`, identity, or generated column  |
| `schema`  | Postgres schema containing the table, the connection's search path when omitted |

Tables are available on the database by name, so a module only needs to export `database`. A table can't be named `sql`, `migrate`, or `check`, or share another table's name; either is a type error.

A table is a schema of its rows:

```ts
type User = Schema.Infer<typeof database.users>;
// { id: string; email: string; name: string | null; created: Date }
```

Columns can be [form fields](/schema#post-forms), so routes reuse the table's rules instead of repeating them:

```ts
const posts = new Table(
	"posts",
	{
		id: Schema.string().uuid(),
		author: Schema.string().uuid(),
		title: Field.text().min(1).max(200),
		body: Field.textarea(),
	},
	{ default: ["id"] },
);

const { title, body } = posts.shape;
const create = Route.post("/posts").fields({ title, body }).use(handler);
```

## Connect

`Database` accepts an application-owned, pg-compatible pool such as [`pg`](https://node-postgres.com/). ovr has no driver dependency and never ends the pool: call `pool.end()` when a script such as a migration finishes, or the open connections keep it running.

Use your provider's pooled connection string for the application, and a direct connection for migrations. ovr doesn't use named prepared statements or session state, which transaction-mode poolers don't support.

## Query

`database.sql` builds a query that runs when awaited. A query is a lazy promise: it runs once, the first time it's awaited or `then`, `catch`, or `finally` is called, and never when it's nested in another query. Tables and columns become quoted identifiers, nested queries are inlined, and every other value is a bound parameter.

```ts
const rows =
	await database.sql`SELECT * FROM ${database.users} WHERE ${database.users.columns.email} = ${email}`;
// unknown[]
```

`.parse()` parses each row with a schema and returns typed rows, throwing a `Schema.AggregateIssue` if any row fails. Pass the table for whole rows, or a schema describing a join or projection. `.parse()` shares the query's single run, so awaiting a query and then `query.parse(schema)` doesn't run it twice.

```ts
const [user] = await database.sql`
	SELECT * FROM ${database.users} WHERE ${database.users.columns.id} = ${id}
`.parse(database.users);

const feed = await database.sql`
	SELECT p.title, u.name FROM ${database.posts} p JOIN ${database.users} u ON u.id = p.author
	WHERE p.published AND u.name IS NOT NULL
`.parse(Schema.object({ title: Schema.string(), name: Schema.string() }));
```

Write conditions in SQL. For optional filters, nest a query when the filter applies and an empty query when it doesn't:

```ts
const posts = await database.sql`
	SELECT * FROM ${database.posts} WHERE true
	${author ? database.sql`AND ${database.posts.columns.author} = ${author}` : database.sql``}
`.parse(database.posts);
```

`database.sql.values()` validates rows and builds an insert. Columns that are nullable or listed in `default` may be omitted, except `Schema.unknown()` columns, which accept any value and must be given unless they're in `default`. `database.sql.set()` validates the supplied columns of an update.

```ts
const [post] = await database.sql`
	INSERT INTO ${database.posts} ${database.sql.values(database.posts, { author: user.id, title })}
	RETURNING *
`.parse(database.posts);

await database.sql`
	UPDATE ${database.posts} SET ${database.sql.set(database.posts, { published: true })}
	WHERE ${database.posts.columns.id} = ${post.id}
`;
```

| Helper                          | Builds                                          |
| ------------------------------- | ----------------------------------------------- |
| `database.sql.values(table, r)` | `(columns) VALUES (...)` for one row or several |
| `database.sql.set(table, v)`    | `column = value, ...`                           |

Column references are qualified with their table name, so write aliased columns like `p.title` directly. A function that returns a query from an `async` function runs it, because awaiting resolves the query.

### Constraint errors

A unique constraint is the reliable way to prevent duplicates. `INSERT … ON CONFLICT DO NOTHING RETURNING *` returns no row for a duplicate; for an `UPDATE`, catch the error and check it with `Database.unique`, optionally naming the constraint so other failures still throw:

```ts
try {
	await database.sql`UPDATE ${database.posts} SET ${database.sql.set(database.posts, result.data)} WHERE ...`;
} catch (error) {
	if (Database.unique(error, "posts_author_title_key")) {
		const invalid = result.invalid({ title: "Already used" });
		return c.redirect(invalid.url, 303);
	}
	throw error;
}
```

## Transact

Pass `database.sql` a callback instead of a template to run its queries as one transaction. It checks out one connection, commits when the callback resolves, and rolls back when it throws. The connection is always released.

```ts
await database.sql(async (t) => {
	await t.sql`DELETE FROM ${database.posts} WHERE ${database.posts.columns.author} = ${user.id}`;
	await t.sql`DELETE FROM ${database.users} WHERE ${database.users.columns.id} = ${user.id}`;
});
```

Use `t.sql` for every query in the transaction. `database.sql` would run on another connection, outside the transaction, and `t.sql` queries can't run after the transaction ends.

A single statement doesn't need a callback: Postgres runs each one atomically. Use one when several statements must succeed or fail together, for example when you read a row, decide in JavaScript, and then write.

A failed query aborts the transaction in Postgres, so catching its error doesn't save the transaction: it rolls back and rethrows the error. Avoid expected errors in the SQL instead, such as with `INSERT … ON CONFLICT DO NOTHING`. Transactions don't nest: helpers that run in one take `t` and use `t.sql`.

## Migrate

Schema changes are SQL migration files, including keys, constraints, indexes, and defaults. `database.migrate()` applies pending migrations in ID order and records each with a checksum.

```sql
-- migrations/0001_init.sql
CREATE TABLE users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	email text NOT NULL UNIQUE,
	name text,
	created timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE posts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	author uuid NOT NULL REFERENCES users ON DELETE CASCADE,
	title text NOT NULL,
	published boolean NOT NULL DEFAULT false
);

CREATE INDEX posts_author_published ON posts (author, published);
```

Run them with a script, for example in a release step, then [check](#check) the tables:

```ts
// scripts/migrate.ts
// with Auth, create it first, so check() knows the users table it references
import "../src/auth.ts";
import { database } from "../src/database.ts";
import { readFile, readdir } from "node:fs/promises";

const dir = new URL("../migrations/", import.meta.url);

const applied = await database.migrate(
	await Promise.all(
		(await readdir(dir))
			.filter((file) => file.endsWith(".sql"))
			.map(async (id) => ({
				id,
				sql: await readFile(new URL(id, dir), "utf8"),
			})),
	),
);
const differences = await database.check();
if (differences.length) throw new Error(differences.join("\n"));

console.log({ applied });
```

- Tables from ovr, such as [`Auth.tables`](/auth#storage) and [`Limiter.table`](/middleware#rate-limiting), bring their own migrations. They are applied first, each library's in the order it lists them, so yours can reference their tables.
- Each migration and its history record commit in one transaction, so a failing migration leaves nothing behind.
- Concurrent runs wait on an advisory lock, so each migration applies once.
- Editing or deleting an applied migration, or adding one that sorts before an applied migration, is an error.
- Statements that cannot run in a transaction, such as `CREATE INDEX CONCURRENTLY`, are not supported, and neither are `BEGIN`, `COMMIT`, or `ROLLBACK`, which would end the migration's transaction. Migrations run through PL/pgSQL's `EXECUTE`, which rejects them.

To build an index on a large production table without blocking writes:

1. Run `CREATE INDEX CONCURRENTLY posts_author_published ON posts (author, published)` from a script.
2. Confirm the index is valid and has the definition you expect. A failed concurrent build leaves an invalid index behind, which `IF NOT EXISTS` would skip. If it's invalid or different, drop it and run step 1 again.

   ```sql
   SELECT indisvalid, pg_get_indexdef(indexrelid)
   FROM pg_index WHERE indexrelid = 'posts_author_published'::regclass;
   ```

3. Add a migration with `CREATE INDEX IF NOT EXISTS posts_author_published ON posts (author, published)`, using the same name and definition.

New databases build the index in the migration, and the production database skips it.

## Check

`database.check()` is a basic compatibility check between the live database and your tables. It returns one line per difference without changing anything.

```ts
await database.check();
// ["users.avatar: missing column (text NULL)"]
```

To change a table, edit its definition, run `check` to see what differs, and write a migration that resolves it. `check` reports:

- Missing tables and columns
- Column types that can't store the column's values
- Nullability that differs from the schema
- Columns in `default` the database doesn't supply
- Other `NOT NULL` columns without a default, which inserts can't omit
- Foreign keys the tables of ovr need, such as [Auth's](/auth#storage) to your users table

Domains count their `NOT NULL` constraints and defaults. Keys, constraints, indexes, and other columns are left to your migrations.

`check` can't guarantee that every value your schemas accept fits the database: SQL ranges, lengths, enum values, and constraints can still reject it. Test those with your migrations and application queries.

## Types

Each column schema can be stored in several Postgres types, and `check` accepts any of them. Domains are compared as their base type.

| Schema                          | Postgres                                                               |
| ------------------------------- | ---------------------------------------------------------------------- |
| `Schema.string()`, string enums | `text`, `varchar`, `char`, `citext`, `uuid`, enum types                |
| `Schema.number()`               | `double precision`, `integer`, `bigint`, `numeric`, `real`, `smallint` |
| `Schema.bigint()`               | `bigint`, `numeric`                                                    |
| `Schema.boolean()`              | `boolean`                                                              |
| `Schema.date()`                 | `timestamptz`, `timestamp`, `date`                                     |
| `Schema.object()`, `array()`    | `jsonb`, `json`                                                        |
| `.nullable()`                   | allows `NULL`                                                          |

Use `.nullable()` for `NULL` and the `default` option for columns the database supplies. Columns can't use `.optional()`, `.default()`, `.transform()`, `.json()`, or schemas without a column type. JSON array items that may be `undefined` must also accept `null`, because JSON stores `undefined` items as `null`.

`bigint` and `numeric` values are converted to the schema's `bigint` or `number`, except integers beyond `Number.MAX_SAFE_INTEGER`, which fail validation instead of losing precision, including `numeric[]` items `pg` has already parsed as numbers. Dates inside JSON are converted from their ISO strings. JSON values are serialized when written through `values` and `set`, and `null` is stored as JSON `null` unless the column is `.nullable()`. Serialize JSON yourself when binding it in other queries.
