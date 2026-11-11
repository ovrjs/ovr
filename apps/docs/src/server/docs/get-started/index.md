---
title: Get Started
description: Install ovr and build a first app that people and agents both use.
---

## Installation

Install the `ovr` package from [npm](https://www.npmjs.com/package/ovr) using your preferred package manager.

```bash
npm i ovr
```

Alternatively, you can setup ovr with a pre-configured template using Vite with [domco](https://domco.robino.dev):

```bash
npx create-domco@latest --framework=ovr
```

## JSX configuration

To utilize JSX, add the following options to your `tsconfig.json` to enable the JSX transform. TypeScript, Vite, or esbuild will pickup the option from this file.

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "ovr" } }
```

Or you can use a comment if you are using ovr in conjunction with another framework to specify the import source for a specific module where you are using ovr.

```tsx
/** @jsxImportSource ovr */
```

> While the ovr package does not depend on React, it uses the same JSX transform as React. This transform is built into `tsc` and other build tools.

## First app

A todo list with a page and a form to add to it. Each route is [described](/route#describe), and the app has an [MCP endpoint](/agents#mcp), so agents can use it too.

In a new folder, install ovr, [srvx](https://srvx.h3.dev/) to serve it on Node, and TypeScript to compile it:

```bash
npm i ovr srvx && npm i -D typescript @types/node
```

```json
// package.json, beside the dependencies npm added
{ "type": "module" }
```

```json
// tsconfig.json
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "NodeNext",
		"strict": true,
		"skipLibCheck": true,
		"rootDir": "src",
		"outDir": "dist",
		"jsx": "react-jsx",
		"jsxImportSource": "ovr"
	}
}
```

```tsx
// src/index.tsx
import { App, Field, Mcp, Route } from "ovr";
import { serve } from "srvx";

const todos: string[] = [];

const list = Route.get("/")
	.describe("List the todos")
	.use((c) => (
		<main>
			<h1>Todos</h1>
			<ul>
				{todos.map((todo) => (
					<li>{todo}</li>
				))}
			</ul>
			{/* state returns a failed submission here, with its message */}
			<add.Form state={c.url} submit="Add" />
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

const app = new App().use(list, add, new Mcp({ name: "todos" }));

// the client IP is for rate limits and Auth, see /app#client-ip
serve({ fetch: (req) => app.fetch(req, { ip: req.ip }) });
```

See [Compatibility](#compatibility) for other runtimes. Compile it and start the server:

```bash
npx tsc && node dist/index.js
```

The todos are kept in memory, so they reset when the server restarts. Store them with [Database](/database) in a real app.

### People

Open `http://localhost:3000`. The page has a form that adds a todo, and works without client-side JavaScript. The field is required, so a submission without it returns to the page with "Required field" beside the input, instead of adding a todo. Browsers stop an empty submission themselves; the server checks too, for anything that reaches it.

### Agents

After adding "Buy milk", request the same page as Markdown:

```bash
curl -H "Accept: text/markdown" http://localhost:3000
```

```md
# Todos

- Buy milk

**Form:** `POST http://localhost:3000/todos?_return=%2F` as `multipart/form-data`

- Todo `text` (text, required)

Submit: Add
```

Or connect an agent to the MCP endpoint, where the two routes are the tools `get_index` and `post_todos`:

```bash
claude mcp add --transport http todos http://localhost:3000/mcp
```

Ask it to add a todo, and it calls `post_todos` with `{ "text": "..." }`. The same handler runs, and the agent reads the list it redirects to as Markdown.

To try an ovr app without building one, connect an agent to these docs, which are an ovr app too:

```bash
claude mcp add --transport http ovr https://ovrjs.com/mcp
```

### Next

[App](/app), [Route](/route), and [Middleware](/middleware) cover handling requests, and [Not found and errors](/middleware#not-found-and-errors) the two middleware most apps start with. [Render](/render) covers components, and [Schema](/schema) the fields and forms. [Agents](/agents) explains what agents get from each route.

## Compatibility

ovr supports only the latest Node.js LTS release and current browsers. Other Fetch-compatible runtimes must provide the modern standard APIs it uses, including `Uint8Array.fromBase64()`, `Uint8Array.prototype.toBase64()`, `Map.prototype.getOrInsertComputed()`, and `WeakMap.prototype.getOrInsertComputed()`. Your hosting provider must support that runtime baseline.

The ovr `App` server can be used in any Fetch API compatible runtime via [`App.fetch`](/app#fetch). Here are a few ways to create a Fetch based HTTP server in various JavaScript runtimes.

- [domco](https://domco.robino.dev) - run `npm create domco` and select `ovr` framework
- [Nitro](https://nitro.build/) - [example repo](https://github.com/rossrobino/nitro-ovr)
- [Cloudflare Vite Plugin](https://developers.cloudflare.com/workers/vite-plugin/get-started/) + [vite-ssr-components](https://github.com/yusukebe/vite-ssr-components)
- [Node + srvx](https://srvx.h3.dev/)
- [Bun HTTP server](https://bun.sh/docs/api/http)
