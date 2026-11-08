---
title: Streaming demo
description: One component streamed as HTML and as Markdown.
---

<!-- prettier-ignore -->
```tsx
const list = Route.get("/todos").use(() => (
	<main>
		<h1>Todos</h1>
		<Todos />
		<add.Form submit="Add" />
	</main>
));

async function Todos() {
	const todos = await db.todos();
	return <ul>{todos.map((todo) => <li>{todo.text}</li>)}</ul>;
}
```
