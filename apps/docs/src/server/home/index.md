---
title: Your app is the API
description: Write each route once. People get pages and forms, agents get Markdown and MCP tools, through the same handler.
---

## One app for people and agents

Most apps are built twice: a website for people, then an API or MCP server for agents. With ovr, the routes are the API. Describe a route, and people get a page with a form while agents read the same page as Markdown or call the route as an [MCP](/10-agents#mcp) tool. Your handlers do not change.

```tsx
const list = Route.get("/todos")
	.describe("List the todos")
	.use(() => (
		<main>
			<h1>Todos</h1>
			<Todos />
			<add.Form submit="Add" />
		</main>
	));

async function Todos() {
	const todos = await db.todos();

	return (
		<ul>
			{todos.map((todo) => (
				<li>
					{todo.text}
					<done.Form params={{ id: todo.id }} submit="Done" />
				</li>
			))}
		</ul>
	);
}

const done = Route.post("/todos/:id/done")
	.describe("Mark a todo as done")
	.use(async (c) => {
		await db.done(c.params.id);
		c.redirect(list, 303);
	});

const add = Route.post("/todos")
	.describe("Add a todo")
	.fields({ text: Field.text({ label: "Todo" }) })
	.use(async (c) => {
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		await db.add(result.data.text);
		c.redirect(list, 303);
	});
```

### People get a page

```html
<h1>Todos</h1>
<ul>
	<li>
		Buy milk
		<form action="/todos/1/done" method="POST" enctype="multipart/form-data">
			<button>Done</button>
		</form>
	</li>
</ul>
<form
	action="/todos"
	method="POST"
	enctype="multipart/form-data"
	toolname="post_todos"
	tooldescription="Add a todo"
>
	<div>
		<label for="text">Todo</label>
		<input id="text" required type="text" name="text" />
	</div>
	<button>Add</button>
</form>
```

The form also names its tool for [WebMCP](/10-agents#webmcp), so an agent in the browser can fill it in.

### Agents read it as Markdown

```md
# Todos

- Buy milk
  **Form:** `POST https://example.com/todos/1/done`

  Submit: Done

**Form:** `POST https://example.com/todos`

- Todo `text` (text, required)

Submit: Add
```

### Agents call it as MCP tools

```txt
get_todos            List the todos        read-only
post_todos           Add a todo            { text: string }
post_todos_id_done   Mark a todo as done   { id: string }
```

The same "Done" button a person clicks is a tool call with an `id` for an agent. With [Auth](/09-auth#agents), the user approves the agent with their passkey, and it acts as them through the same handlers.

## Define a field once

A `Table` describes a Postgres table with the same schemas forms use, so a column can be a form field. The add route takes `text` straight from the todos table, and that one definition is the form people fill in, the data the handler gets, the insert into Postgres, the line agents read, and the input of the MCP tool.

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

The form, with its WebMCP tool:

```html
<form
	action="/todos"
	method="POST"
	enctype="multipart/form-data"
	toolname="post_todos"
	tooldescription="Add a todo"
>
	<div>
		<label for="text">Todo</label>
		<input id="text" required type="text" name="text" />
	</div>
	<button>Add</button>
</form>
```

What the handler gets from `await c.data()`:

```ts
.use(async (c) => {
	const result = await c.data();

	// text = "Buy bread"
	result.data; // { text: "Buy bread" }

	// text = ""
	result.issues; // [{ path: ["text"], message: "Required field" }]
});
```

The insert it sends to Postgres:

```sql
INSERT INTO "todos" ("text") VALUES ($1) -- $1 = 'Buy bread'
```

The line agents read:

```md
- Todo `text` (text, required)
```

The input of the `post_todos` tool:

```json
{
	"type": "object",
	"properties": { "text": { "type": "string", "title": "Todo" } },
	"required": ["text"]
}
```

## Streaming

ovr evaluates components in parallel and streams HTML in order, as an [`AsyncGenerator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator) that feeds straight into the response. Nothing waits for the slowest component: what is ready goes out first, and the rest follows as it resolves.

<div class="grid sm:grid-cols-2 sm:gap-4 *:my-2">

```tsx hide
function Component() {
	return (
		<p>
			hello <Username />
		</p>
	);
}

async function Username() {
	// slow async work...
	const user = await getUser();

	return <span>{user.name}</span>;
}
```

```ts hide
"<p>";
"hello ";
// streamed immediately

// as soon as getUser() resolves
"<span>";
"username";
"</span>";

"</p>";
```

</div>

Browsers are [built for streaming](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work#parsing). They parse and paint HTML as it arrives, and the head goes out first, so CSS and JavaScript start downloading while the body renders. The result is a fast [Time-To-First-Byte](https://web.dev/articles/ttfb#what_is_ttfb) with no hydration bundle and no buffering.

## Constraints

ovr is intentionally constrained. These rules keep the framework small and shape the API.

- **No client JS required.** Everything works when no client-side JavaScript runs.
- **Streaming first.** Responses and request parsing start immediately, without buffering whole documents or uploads in memory.
- **Stateless servers.** Nothing is kept in memory between requests: forms carry their issues in the URL, MCP needs no sessions, and auth keeps its sessions in your database, so any instance can answer any request.

## Get started

```sh
npm i ovr
```

These docs are an ovr app. Connect your agent to them:

```sh
claude mcp add --transport http ovr https://ovrjs.com/mcp
```

Continue with [Get Started](/01-get-started).
