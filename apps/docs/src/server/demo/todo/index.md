---
title: Todo
description: A basic todo app built with ovr.
---

A server driven todo app that stores data in the URL.

```tsx
import { Field, Route, Schema } from "ovr";

const id = Field.hidden().transform(Number).int();
const text = Field.text()
	.transform((s) => s.trim())
	.min(1)
	.persist();
const list = Field.hidden()
	.json(Schema.array(Schema.object({ done: Field.checkbox(), id, text })))
	.default([{ done: false, id: 0, text: "Build a todo app" }]);

export const add = Route.post({ list, text }, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	const { list, text } = result.data;

	list.push({ done: false, id: (list.at(-1)?.id ?? 0) + 1, text });

	c.redirect(todo.url({ search: { list: JSON.stringify(list) } }), 303);
});

export const toggle = Route.post({ list, id }, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	const target = result.data.list.find((todo) => todo.id === result.data.id);

	if (target) target.done = !target.done;

	c.redirect(
		todo.url({ search: { list: JSON.stringify(result.data.list) } }),
		303,
	);
});

export const todo = Route.get("/demo/todo", { list }, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	const { list } = result.data;
	const json = JSON.stringify(list);
	const TextField = add.component({ name: "text", state: c.url });

	return (
		<>
			<h1>Todo</h1>

			<add.Form>
				<add.Field name="list" value={json} />

				<TextField.Root>
					<TextField.Label class="sr-only" />
					<TextField.Control placeholder="Add a todo" />
					<TextField.Issue />
				</TextField.Root>

				<button>Add</button>
			</add.Form>

			<ul>
				{list.map((todo) => (
					<li>
						<toggle.Form>
							<toggle.Field name="list" value={json} />
							<toggle.Field name="id" value={todo.id} />

							<button aria-label="toggle todo">
								<span
									class={
										todo.done
											? "icon-[lucide--check]"
											: "icon-[lucide--square-dashed]"
									}
								/>
							</button>

							{todo.done ? <s>{todo.text}</s> : <span>{todo.text}</span>}
						</toggle.Form>
					</li>
				))}
			</ul>

			<todo.Anchor>Reset</todo.Anchor>
		</>
	);
});
```
