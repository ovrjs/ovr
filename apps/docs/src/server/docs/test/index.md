---
title: Test
description: Test an app as a signed-in person and as their agent, without a browser, a passkey, or an agent.
---

## Tester

`Tester` uses an app as one person does, and as the agent they connected. Each request runs through the whole app: its middleware, its [CSRF](/app#csrf) check, its routes, and its [MCP endpoint](/agents). It needs no browser, no passkey, and no agent.

It is imported from `ovr/test`, apart from `ovr`, so it stays out of the app.

```ts
import { app, auth } from "./app";
import { Tester } from "ovr/test";

const ross = new Tester({ app, auth, user: "user-1" });
```

`user` is the ID of an account the test created. The tester is signed in as that user without a passkey. Leave `user` out for a visitor who is signed out, and leave `auth` out too for an app that has none.

Use any test runner. These examples use Node's.

## As a person

`tester.fetch(route, init)` requests a route as a browser does: with the person's cookies, and a form's fields sent the way its form sends them. It returns the app's `Response`.

```ts
import * as recipes from "./recipes";
import assert from "node:assert/strict";
import { test } from "node:test";

test("saves a recipe", async () => {
	const saved = await ross.fetch(recipes.create, {
		data: {
			title: "Turkey chili",
			vegan: false,
			ingredients: [{ name: "ground turkey", amount: "1 lb" }],
			steps: ["Brown the turkey", "Simmer 30 minutes"],
		},
	});

	assert.equal(saved.status, 303);

	const page = await ross.fetch(saved.headers.get("location")!);
	assert.match(await page.text(), /Turkey chili/);
});
```

- `params`, `search`, and `hash` are the route's, as [`route.url()`](/route#url) takes them. A route with parameters requires them.
- `data` is the route's field values by name: an array of rows for a [list](/schema#lists), an array of strings for lines, `true` for a ticked box, and a `File` for a file field. A name the route does not have is a type error. A value is not checked, so a test can send one the route refuses.
- A GET route's `data` is sent in the search, as its form submits it.
- A redirect is not followed. Pass its `location` to `fetch` to request the page it leads to.
- Cookies the app sets are kept and sent back, as a browser does.

### A refused submission

A route that refuses a submission redirects with the form's [state](/schema#persisted-form-state). `route.state(url)` reads it back: the issues found, and the values kept.

```ts
test("a recipe needs a title", async () => {
	const refused = await ross.fetch(recipes.create, { data: { title: "" } });
	const state = recipes.create.state(refused.headers.get("location")!);

	assert.deepEqual(
		state?.issues?.map((issue) => issue.path),
		[["title"]],
	);
});
```

## As an agent

`tester.call(route, args)` calls a described route's tool as the person's agent does: a `tools/call` request to the app's MCP endpoint, with the token of an agent the person connected. The arguments are the route's parameters and its fields, as an agent sends them.

```ts
test("an agent changes a title", async () => {
	const result = await ross.call(recipes.update, { id: "1", title: "Chili" });

	assert.equal(result.isError, false);
});
```

The result is the tool's, as the agent receives it:

| Property            | What it holds                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `content`           | What the agent reads: the page as Markdown, or `Redirected to` a page, then any file or image |
| `isError`           | `true` when the route refused the call. The text says why, such as which field is wrong       |
| `structuredContent` | The object a route answered with as [JSON](/agents#results)                                   |

- A file argument is an object with its `name`, its `type`, and its `text` or `base64`, as an agent sends a file.
- When the endpoint refuses the request itself, `call` throws. A tester without a `user` is refused with `Unauthorized` by an endpoint that has `auth`.
- The agent is named Tester. Once it has made a call, [`auth.agents(c)`](/auth#agents) lists it, and disconnecting it refuses its next call.

## A database

Signing in and connecting an agent write real rows: a session, and the agent's tokens. Run tests against a database of their own, never the one people use.

[PGlite](https://pglite.dev) is Postgres in the test's own process, which needs no server. It has one connection, so the pool gives it out one query or transaction at a time:

```ts
import { PGlite } from "@electric-sql/pglite";
import { Database } from "ovr";

const engine = await PGlite.create();

let turn = Promise.resolve();
const acquire = () => {
	let release!: () => void;
	const previous = turn;
	turn = new Promise((resolve) => (release = resolve));
	return previous.then(() => release);
};
const run = async (text: string, values?: unknown[]) =>
	values?.length
		? engine.query(text, values)
		: ((await engine.exec(text)).at(-1) ?? { rows: [] });

const pool: Database.Pool = {
	async query(text, values) {
		const release = await acquire();
		try {
			return await run(text, values);
		} finally {
			release();
		}
	},
	async connect() {
		return { query: run, release: await acquire() };
	},
};
```

Create the database with this pool when the app is tested, apply its [migrations](/database#migrate), and insert the accounts the testers act as.
