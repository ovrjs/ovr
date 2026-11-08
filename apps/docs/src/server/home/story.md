---
title: People and agents
description: The todo routes the home page story walks through.
---

<!-- prettier-ignore -->
```tsx
const list = Route.get("/todos")
	.describe("List the todos")
	.use(async () => (
		<main>
			<h1>Todos</h1>
			<ul>
				{(await todos.all()).map((todo) => (
					<li>
						{todo.text}
						<done.Form params={{ id: todo.id }} submit="Done" />
					</li>
				))}
			</ul>
			<add.Form submit="Add" />
		</main>
	));

const add = Route.post("/todos")
	.describe("Add a todo")
	.fields({ text: Field.text({ label: "Todo" }) })
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		await todos.add(result.data.text);
		c.redirect(list, 303);
	});

const done = Route.post("/todos/:id/done")
	.describe("Mark a todo as done")
	.use(async (c) => {
		await todos.done(c.params.id);
		c.redirect(list, 303);
	});


