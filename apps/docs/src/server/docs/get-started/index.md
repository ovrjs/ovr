---
title: Get started
description: Install ovr and build a first app that people and agents both use.
---

## First app

Create an app with [domco](https://domco.robino.dev), which sets up ovr with Vite and a dev server:

```bash
npx create-domco@latest --framework=ovr
```

Then replace the app with a todo list: a page, and a form to add to it. Each route is [described](/route#describe), and the app has an [MCP endpoint](/agents#mcp), so agents can use it too.

```tsx
// src/server/+app.tsx
import { App, Field, Mcp, Route } from "ovr";

const todos: string[] = [];

// a part of the page, which reads what it shows
function Todos() {
	return (
		<ul>
			{todos.map((todo) => (
				<li>{todo}</li>
			))}
		</ul>
	);
}

const list = Route.get("/")
	.describe("List the todos")
	.use(() => (
		<main>
			<h1>Todos</h1>
			<Todos />
			{/* the add route's form, with what a refused submission sent */}
			<add.Form submit="Add" />
		</main>
	));

const add = Route.post("/todos")
	.describe("Add a todo")
	.fields({ text: Field.text().label("Todo") })
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		todos.push(result.data.text);
		c.redirect(list, 303);
	});

export default new App().use(list, add, new Mcp({ name: "todos" }));
```

```bash
npm run dev
```

The todos are kept in memory, so they reset when the server restarts. Store them with [Database](/database) in a real app.

The route only puts the page together, and `Todos` reads the list it shows. Build every page this way: a route waits only for what decides the response, such as a redirect or a 404, and each part of the page is a component that reads its own data. See [Pages](/pages).

### People

Open `http://localhost:5173`. The page has a form that adds a todo, and works without client-side JavaScript. The field is required, so a submission without it returns to the page with "Required field" beside the input, instead of adding a todo. Browsers stop an empty submission themselves; the server checks too, for anything that reaches it.

### Agents

After adding "Buy milk", request the same page as Markdown:

```bash
curl -H "Accept: text/markdown" http://localhost:5173
```

```md
# Todos

- Buy milk

**Form:** `POST http://localhost:5173/todos?_return=%2F` as `multipart/form-data`

- Todo `text` (text, required)

Submit: Add
```

Or connect an agent to the MCP endpoint, where the two routes are the tools `get_index` and `post_todos`. Ask the agent to do it:

```md
Add the MCP server at http://localhost:5173/mcp as a connector named "todos",
then add a todo to it.
```

It calls `post_todos` with `{ "text": "..." }`. The same handler runs, and the agent reads the list it redirects to as Markdown.

To try an ovr app without building one, connect an agent to these docs, which are an ovr app too:

```md
Add the MCP server at https://ovrjs.com/mcp as a connector named "ovr".
```

## Without a template

Install the `ovr` package from [npm](https://www.npmjs.com/package/ovr):

```bash
npm i ovr
```

Add the JSX options to your `tsconfig.json`, which TypeScript, Vite, and esbuild read:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "ovr" } }
```

Or set the import source for one module with a comment, such as beside another framework:

```tsx
/** @jsxImportSource ovr */
```

An `App` is served by anything that takes a Fetch handler, with [`app.fetch`](/app#fetch). [Nitro](https://nitro.build/) is another full-stack setup, with an [example](https://github.com/rossrobino/nitro-ovr).

## Compatibility

ovr supports the latest versions of popular server runtimes and browsers.
