---
title: Define a field once
description: The todos table and the add route the home page fields section shows.
---

```tsx
const todos = new Table(
	"todos",
	{
		id: Schema.string().uuid(),
		text: Field.text({ label: "Todo" }),
		done: Schema.boolean(),
	},
	{ default: ["id", "done"] },
);

const add = Route.post("/todos")
	.describe("Add a todo")
	.fields({ text: todos.shape.text })
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		await db.sql`
			INSERT INTO ${todos} ${db.sql.values(todos, result.data)}
		`;
		c.redirect(list, 303);
	});
```
