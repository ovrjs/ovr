---
"ovr": minor
---

`Database.Query` names the type of a query from `database.sql`.

```ts
export const userOf = (id: string) =>
	database.sql`SELECT * FROM ${database.users} WHERE ...`.parse(database.users);
```

An exported function that returns a query had no type a declaration file could name, so it was an error in a project that emits declarations, unless the function was `async` or its return type was written out as a `Promise`. `database.sql`, `sql.values`, `sql.set`, and `parse` return a `Database.Query`.
