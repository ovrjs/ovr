import { App } from "../app/index.js";
import { jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Field, Schema } from "../schema/index.js";
import { Mcp } from "./index.js";
import { describe, expect, test } from "vitest";

const version = "2026-07-28";

/** A request with the protocol version and the headers that mirror it */
function request(
	method: string,
	params: Record<string, unknown> = {},
	headers: Record<string, string> = {},
): RequestInit {
	const name = (params.name ?? params.uri) as string | undefined;

	return {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"mcp-protocol-version": version,
			"mcp-method": method,
			...(name ? { "mcp-name": name } : {}),
			...headers,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method,
			params: {
				...params,
				_meta: {
					"io.modelcontextprotocol/protocolVersion": version,
					"io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	};
}

function setup() {
	const posts = new Map([["1", "First post"]]);

	const list = Route.get("/posts")
		.describe("List posts")
		.use(() =>
			jsx("main", {
				children: [
					jsx("h1", { children: "Posts" }),
					jsx("ul", {
						children: Array.from(posts, ([id, title]) =>
							jsx("li", { children: `${id}: ${title}` }),
						),
					}),
				],
			}),
		);

	const show = Route.get("/posts/:id")
		.describe("Show a post")
		.params({ id: Schema.string().preprocess(String) })
		.use((c) => {
			const title = posts.get(c.params.id);
			if (!title) return c.text("Not Found", 404);
			return jsx("main", { children: jsx("h1", { children: title }) });
		});

	const search = Route.get("/search")
		.describe("Search posts")
		.fields({ q: Field.search() })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return;
			return jsx("p", { children: `Results for ${result.data.q}` });
		});

	const create = Route.post("/posts")
		.describe("Create a post")
		.fields({ title: Field.text().min(3), draft: Field.checkbox() })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return c.redirect(result.url, 303);
			if (result.data.title === "Taken")
				return c.redirect(result.invalid({ title: "Already used" }).url, 303);
			posts.set(String(posts.size + 1), result.data.title);
			return c.redirect(list, 303);
		});

	const remove = Route.post("/posts/:id/delete")
		.describe("Delete a post")
		.use((c) => {
			if (!posts.delete(c.params.id)) return c.text("Not Found", 404);
			return c.redirect(list, 303);
		});

	const hidden = Route.post("/internal").use(() => "secret");

	const app = new App().use(
		new Mcp({ name: "posts", instructions: "Manage posts." }),
		list,
		show,
		search,
		create,
		remove,
		hidden,
	);

	const rpc = async (
		method: string,
		params: Record<string, unknown> = {},
		headers: Record<string, string> = {},
	) => {
		const res = await app.fetch(
			"http://localhost/mcp",
			request(method, params, headers),
		);

		const text = await res.text();

		return {
			status: res.status,
			body: (text.startsWith("{") ? JSON.parse(text) : text) as any,
		};
	};

	return { app, rpc, posts };
}

describe("Mcp", () => {
	test.each([
		["/", "/index"],
		["/items/:id", "/items/id"],
		["/files/*", "/files/wildcard"],
	])("%s and %s clash when the app starts", (first, second) => {
		const { app } = setup();
		// before any agent lists the tools, so discovery never breaks
		expect(() =>
			app.use(
				Route.post(first)
					.describe("First")
					.use(() => "one"),
				Route.post(second)
					.describe("Second")
					.use(() => "two"),
			),
		).toThrow(`change one of their patterns`);
	});
	test("distinct route patterns can expose tools without taking down discovery", async () => {
		const { app, rpc } = setup();
		app.use(
			Route.post("/a/b")
				.describe("Nested")
				.use(() => "nested"),
			Route.post("/a_b")
				.describe("Flat")
				.use(() => "flat"),
		);
		const { body } = await rpc("tools/list");
		const tools = body.result.tools.filter((tool: { description: string }) =>
			["Nested", "Flat"].includes(tool.description),
		);
		expect(new Set(tools.map((tool: { name: string }) => tool.name)).size).toBe(
			2,
		);
	});
	test("a wildcard argument cannot change the request's origin", async () => {
		const { app, rpc } = setup();
		const origins: string[] = [];
		app.use(
			Route.post("/*")
				.describe("Catch all")
				.use((c) => {
					origins.push(c.url.origin);
					return "ok";
				}),
		);
		await rpc("tools/call", {
			name: "post_wildcard",
			arguments: { wildcard: "/other.example/private" },
		});
		expect(origins).not.toContain("http://other.example");
	});
	test("a mounted tool cannot be changed later", async () => {
		const { app } = setup();
		const route = Route.post("/toggle")
			.describe("Toggle")
			.use(() => {});
		app.use(route);
		expect(() => route.describe("Other")).toThrow("before app.use()");
		expect(() => route.use(() => {})).toThrow("before app.use()");
	});
	test("mounting a service twice cannot switch the first endpoint to another app", async () => {
		const mcp = new Mcp();
		const first = new App().use(
			mcp,
			Route.get("/tenant")
				.describe("Tenant")
				.use(() => "first tenant"),
		);
		try {
			new App().use(
				mcp,
				Route.get("/tenant")
					.describe("Tenant")
					.use(() => "second tenant"),
			);
		} catch (error) {
			// Refusing a second mount also keeps the first app isolated.
			if (!(error instanceof TypeError)) throw error;
		}
		const res = await first.fetch(
			"http://localhost/mcp",
			request("resources/read", { uri: "http://localhost/tenant" }),
		);
		expect((await res.json()).result.contents[0].text.trim()).toBe(
			"first tenant",
		);
	});

	test("resources/read does not run undescribed GET handlers", async () => {
		const { app, rpc } = setup();
		let called = false;
		app.use(
			Route.get("/private").use(() => {
				called = true;
				return "private data";
			}),
		);
		await rpc("resources/read", { uri: "http://localhost/private" });
		expect(called).toBe(false);
	});

	test.each(["private", ".."])(
		"a tool parameter %s cannot dispatch a hidden POST",
		async (id) => {
			const { app, rpc } = setup();
			let called = false;
			app.use(
				Route.post("/edit/:id")
					.describe("Edit one item")
					.use(() => "edited"),
				Route.post("/edit/private").use(() => {
					called = true;
				}),
				Route.post("/").use(() => {
					called = true;
				}),
			);
			await rpc("tools/call", { name: "post_edit_id", arguments: { id } });
			expect(called).toBe(false);
		},
	);

	test("a tool redirect cannot fetch a hidden resource", async () => {
		const { app, rpc } = setup();
		let called = false;
		app.use(
			Route.post("/go").use((c) => c.redirect("/private", 303)),
			Route.get("/private").use(() => {
				called = true;
			}),
		);
		await rpc("tools/call", { name: "post_go" });
		expect(called).toBe(false);
	});

	test("a page an agent reads points a form to its tool, with only its values", async () => {
		const { app, rpc } = setup();
		const rename = Route.post("/notes/:id/rename")
			.describe("Rename a note")
			.fields({
				title: Field.text({ label: "Title" }).min(1),
				pinned: Field.checkbox(),
			})
			.use(() => {});
		const archive = Route.post("/notes/:id/archive")
			.fields({ reason: Field.text() })
			.use(() => {});
		app.use(
			rename,
			archive,
			Route.get("/notes/:id")
				.describe("Show a note")
				.use((c) =>
					jsx("main", {
						children: [
							rename.Form({
								params: { id: c.params.id },
								values: { title: "Groceries" },
								submit: "Save",
							}),
							archive.Form({ params: { id: c.params.id } }),
						],
					}),
				),
		);
		const { body } = await rpc("tools/call", {
			name: "get_notes_id",
			arguments: { id: "7" },
		});
		expect(body.result.content[0].text).toBe(
			[
				"**Form:** `POST http://localhost/notes/7/rename` (tool `post_notes_id_rename`)",
				"",
				"- `title`: `Groceries`",
				// unchecked, a boolean argument
				"- `pinned`: `false`",
				"",
				"Submit: Save",
				"",
				// not a tool, so described in full
				"**Form:** `POST http://localhost/notes/7/archive`",
				"",
				"- reason `reason` (text)",
				"",
				"Submit: Submit",
				"",
			].join("\n"),
		);
	});

	test("a page preserves the value of a checkbox group with one option", async () => {
		const { app, rpc } = setup();
		const route = Route.post("/preferences")
			.describe("Save preferences")
			.fields({ tags: Field.checkboxes(["news"]) });
		app.use(
			route,
			Route.get("/preferences")
				.describe("Edit preferences")
				.use(() => route.Form({ values: { tags: ["news"] } })),
		);
		const { body } = await rpc("resources/read", {
			uri: "http://localhost/preferences",
		});
		expect(body.result.contents[0].text).toContain("- `tags`: `news`");
		expect(body.result.contents[0].text).not.toContain("- `tags`: `true`");
	});

	test("a tool reports a parameter its schema rejects, instead of a bare 404", async () => {
		const { app, rpc } = setup();
		let called = false;
		app.use(
			Route.get("/items/:id")
				.describe("Show an item")
				.params({ id: Schema.string().uuid() })
				.use(() => {
					called = true;
					return "item";
				}),
		);
		const { body } = await rpc("tools/call", {
			name: "get_items_id",
			arguments: { id: "not-a-uuid" },
		});
		expect(called).toBe(false);
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toBe(
			`422 Unprocessable Content\n\n${JSON.stringify({ issues: [{ path: "id", message: "Expected UUID" }] })}`,
		);
	});

	test("a tool redirect keeps the address of a page agents cannot read private", async () => {
		const { app, rpc } = setup();
		app.use(
			Route.post("/private-go")
				.describe("Go somewhere private")
				.use((c) => c.redirect("/private?token=secret", 303)),
			Route.get("/private").use(() => "private"),
			Route.post("/checkout")
				.describe("Start a checkout")
				.use((c) => c.redirect("https://pay.example/checkout?session=1", 303)),
		);
		const hidden = await rpc("tools/call", {
			name: Route.post("/private-go").describe("x").tool!.name,
		});
		expect(JSON.stringify(hidden.body)).not.toContain("secret");
		expect(hidden.body.result.content[0].text).toBe("Redirected");
		// another site is where the app sends the user, such as a payment page
		const away = await rpc("tools/call", { name: "post_checkout" });
		expect(away.body.result.content[0].text).toBe(
			"Redirected to https://pay.example/checkout?session=1",
		);
	});

	test("an oversized chunked MCP request stops at the limit", async () => {
		const { app } = setup();
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					if (++pulls === 1) controller.enqueue(new Uint8Array(1024 ** 2 + 1));
					else controller.close();
				},
			},
			{ highWaterMark: 0 },
		);
		const req = new Request("http://localhost/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			...{ duplex: "half" },
		});
		expect((await app.fetch(req)).status).toBe(413);
		expect(pulls).toBe(1);
	});

	test("disconnecting an MCP client aborts its in-flight resource request", async () => {
		const { app } = setup();
		const started = Promise.withResolvers<AbortSignal>();
		const finish = Promise.withResolvers<void>();
		app.use(
			Route.get("/slow")
				.describe("Slow")
				.use(async (c) => {
					started.resolve(c.req.signal);
					await finish.promise;
					return "done";
				}),
		);
		const client = new AbortController();
		const pending = app.fetch("http://localhost/mcp", {
			...request("resources/read", { uri: "http://localhost/slow" }),
			signal: client.signal,
		});
		const downstream = await started.promise;
		client.abort();
		try {
			expect(downstream.aborted).toBe(true);
		} finally {
			finish.resolve();
			await pending.catch(() => undefined);
		}
	});

	test("server/discover describes the server", async () => {
		const { rpc } = setup();
		const { status, body } = await rpc("server/discover");

		expect(status).toBe(200);
		expect(body.result).toMatchObject({
			resultType: "complete",
			supportedVersions: ["2026-07-28"],
			capabilities: { tools: {}, resources: {} },
			instructions: "Manage posts.",
			_meta: {
				"io.modelcontextprotocol/serverInfo": {
					name: "posts",
					version: "1.0.0",
				},
			},
		});
	});

	test("routes become tools", async () => {
		const { rpc } = setup();
		const { body } = await rpc("tools/list");
		const tools = body.result.tools;

		expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
			"get_posts",
			"get_posts_id",
			"get_search",
			"post_posts",
			"post_posts_id_delete",
		]);
		expect(body.result).toMatchObject({ ttlMs: 60000, cacheScope: "public" });

		const [list, , search, create, remove] = tools;

		expect(list).toEqual({
			name: "get_posts",
			description: "List posts",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true, openWorldHint: false },
		});
		expect(search.description).toBe("Search posts");
		expect(Object.keys(search.inputSchema.properties)).toEqual(["q"]);
		expect(create.inputSchema.properties.title).toMatchObject({ minLength: 3 });
		// like a browser, an agent may leave an unchecked box out
		expect(create.inputSchema.properties.draft).toEqual({
			type: "boolean",
			default: false,
		});
		expect(create.inputSchema.required).toEqual(["title"]);
		// writes claim nothing more, so clients treat them as possibly destructive
		expect(create.annotations).toEqual({
			readOnlyHint: false,
			openWorldHint: false,
		});
		expect(remove.inputSchema).toEqual({
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		});
		expect(remove.annotations).not.toHaveProperty("destructiveHint");
	});

	test("tools call the route and follow its redirect", async () => {
		const { rpc, posts } = setup();
		const { body } = await rpc("tools/call", {
			name: "post_posts",
			arguments: { title: "Second post", draft: true },
		});

		expect(posts.get("2")).toBe("Second post");
		expect(body.result).toEqual({
			resultType: "complete",
			content: [
				{
					type: "text",
					text: "Redirected to /posts\n\n# Posts\n\n- 1: First post\n- 2: Second post\n",
				},
			],
			isError: false,
			_meta: expect.any(Object),
		});
	});

	test("resources/read reports form validation issues instead of successful empty contents", async () => {
		const { rpc } = setup();
		const { body } = await rpc("resources/read", {
			uri: "http://localhost/search",
		});
		expect(body.error).toBeDefined();
		expect(body.error.message).toContain('"path":"q"');
		expect(body.result).toBeUndefined();
	});

	test("invalid arguments are tool errors with the issues", async () => {
		const { rpc } = setup();
		const short = await rpc("tools/call", {
			name: "post_posts",
			arguments: { title: "x" },
		});

		expect(short.body.result.isError).toBe(true);
		expect(short.body.result.content[0].text).toMatch(/^422/);
		expect(
			JSON.parse(short.body.result.content[0].text.split("\n\n")[1]),
		).toEqual({ issues: [{ path: "title", message: expect.any(String) }] });

		const taken = await rpc("tools/call", {
			name: "post_posts",
			arguments: { title: "Taken" },
		});

		expect(taken.body.result.content[0].text).toContain("Already used");
	});

	test("parameters, missing parameters, and errors", async () => {
		const { rpc, posts } = setup();

		const missing = await rpc("tools/call", {
			name: "post_posts_id_delete",
			arguments: {},
		});
		expect(missing.body.result).toMatchObject({
			isError: true,
			content: [{ text: "Missing required parameter: id" }],
		});

		const gone = await rpc("tools/call", {
			name: "post_posts_id_delete",
			arguments: { id: "9" },
		});
		expect(gone.body.result.isError).toBe(true);
		expect(gone.body.result.content[0].text).toContain("404");

		await rpc("tools/call", {
			name: "post_posts_id_delete",
			arguments: { id: "1" },
		});
		expect(posts.has("1")).toBe(false);

		const search = await rpc("tools/call", {
			name: "get_search",
			arguments: { q: "ovr" },
		});
		expect(search.body.result.content[0].text).toBe("Results for ovr\n");

		const unknown = await rpc("tools/call", { name: "nope", arguments: {} });
		expect(unknown.body.error.code).toBe(-32602);
	});

	test("an invalid request ID cannot execute a tool", async () => {
		const { app, posts } = setup();
		const init = request("tools/call", {
			name: "post_posts_id_delete",
			arguments: { id: "1" },
		});
		const res = await app.fetch("http://localhost/mcp", {
			...init,
			body: JSON.stringify({ ...JSON.parse(String(init.body)), id: {} }),
		});
		expect.soft(posts.has("1")).toBe(true);
		expect(await res.json()).toMatchObject({
			id: null,
			error: { code: -32600 },
		});
	});

	test("a named wildcard and a trailing wildcard cannot share one argument", () => {
		void (() => {
			// @ts-expect-error both would be the tool's `wildcard` argument
			Route.post("/remove/:wildcard/*").describe("Remove the selected file");
			// either alone is a tool
			Route.post("/remove/:wildcard").describe("Remove the selected file");
			Route.post("/remove/*").describe("Remove the selected file");
		});
	});

	test("an MCP resource URI with credentials returns a protocol error", async () => {
		const { rpc } = setup();
		const { body } = await rpc("resources/read", {
			uri: "http://user:password@localhost/posts",
		});
		expect(body.error).toBeDefined();
	});

	test("a tool preserves a named parameter called wildcard on a write", async () => {
		const { app, rpc } = setup();
		const removed: string[] = [];
		const route = Route.post("/remove/:wildcard")
			.describe("Remove the selected entry")
			.use((c) => {
				removed.push(c.params.wildcard);
				c.text("removed");
			});
		app.use(route);
		await rpc("tools/call", {
			name: route.tool!.name,
			arguments: { wildcard: "draft" },
		});
		expect(removed).toEqual(["draft"]);
	});

	test("an unpaired surrogate in a tool parameter returns a protocol error", async () => {
		const { rpc } = setup();
		const { body } = await rpc("tools/call", {
			name: "post_posts_id_delete",
			arguments: { id: "\ud800" },
		});
		expect(body.result?.isError === true || body.error?.code === -32602).toBe(
			true,
		);
	});

	test("a tool passes a wildcard following a literal prefix to its handler", async () => {
		const { app, rpc } = setup();
		const files = Route.get("/file-*")
			.describe("Read file")
			.use((c) => c.text(c.params["*"]));
		app.use(files);
		const { body } = await rpc("tools/call", {
			name: files.tool!.name,
			arguments: { wildcard: "archive/report" },
		});
		expect(body.result.content).toEqual([
			{ type: "text", text: "archive/report" },
		]);
	});

	test("described pages are resources", async () => {
		const { app, rpc } = setup();
		// undescribed pages are not served to agents
		app.use(
			Route.get("/about").use(() => "About"),
			Route.get("/drafts/:id").use(() => "Draft"),
		);

		const list = await rpc("resources/list");
		expect(list.body.result.resources).toEqual([
			{
				uri: "http://localhost/posts",
				name: "/posts",
				description: "List posts",
				mimeType: "text/markdown",
			},
			{
				uri: "http://localhost/search",
				name: "/search",
				description: "Search posts",
				mimeType: "text/markdown",
			},
		]);

		const templates = await rpc("resources/templates/list");
		expect(templates.body.result.resourceTemplates).toEqual([
			{
				uriTemplate: "http://localhost/posts/{id}",
				name: "/posts/:id",
				description: "Show a post",
				mimeType: "text/markdown",
			},
		]);

		const read = await rpc("resources/read", {
			uri: "http://localhost/posts/1",
		});
		expect(read.body.result.contents).toEqual([
			{
				uri: "http://localhost/posts/1",
				mimeType: "text/markdown",
				text: "# First post\n",
			},
		]);

		const missing = await rpc("resources/read", {
			uri: "http://localhost/posts/7",
		});
		expect(missing.body.error.code).toBe(-32002);

		const other = await rpc("resources/read", {
			uri: "https://example.com/posts",
		});
		expect(other.body.error.code).toBe(-32002);
	});

	test("headers must match the request", async () => {
		const { rpc } = setup();

		const method = await rpc("tools/list", {}, { "mcp-method": "tools/call" });
		expect(method.status).toBe(400);
		expect(method.body.error.code).toBe(-32020);

		const name = await rpc(
			"tools/call",
			{ name: "get_posts", arguments: {} },
			{ "mcp-name": "post_posts" },
		);
		expect(name.body.error.code).toBe(-32020);

		const encoded = await rpc(
			"tools/call",
			{ name: "get_posts", arguments: {} },
			{ "mcp-name": `=?base64?${btoa("get_posts")}?=` },
		);
		expect(encoded.body.result.isError).toBe(false);

		const header = await rpc(
			"tools/list",
			{},
			{ "mcp-protocol-version": "2025-11-25" },
		);
		expect(header.body.error.code).toBe(-32020);

		const unknown = await rpc("prompts/list");
		expect(unknown.status).toBe(404);
		expect(unknown.body.error.code).toBe(-32601);
	});

	test("unsupported versions list the supported ones", async () => {
		const { app } = setup();
		const res = await app.fetch("http://localhost/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"mcp-protocol-version": "1900-01-01",
				"mcp-method": "tools/list",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
				params: {
					_meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" },
				},
			}),
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: {
				code: -32022,
				data: {
					supported: expect.arrayContaining(["2026-07-28"]),
					requested: "1900-01-01",
				},
			},
		});
	});

	test("earlier clients that initialize are told the supported version", async () => {
		const { app } = setup();
		const res = await app.fetch("http://localhost/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 0,
				method: "initialize",
				params: { protocolVersion: "2025-06-18", capabilities: {} },
			}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatchObject({
			code: -32022,
			data: { supported: ["2026-07-28"], requested: null },
		});
	});

	test("two routes cannot share a tool name", () => {
		const { app } = setup();
		expect(() =>
			app.use(
				// a parameter and a literal segment with the same text
				Route.post("/drafts/:id").describe("Edit a draft"),
				Route.post("/drafts/id").describe("Make an ID"),
			),
		).toThrow(
			'Tool name "post_drafts_id" is used by POST /drafts/:id and POST /drafts/id',
		);
	});

	test("rejects other origins, other methods, and malformed requests", async () => {
		const { app, rpc } = setup();

		const origin = await rpc(
			"tools/list",
			{},
			{ origin: "https://evil.example" },
		);
		expect(origin.status).toBe(403);

		const get = await app.fetch("http://localhost/mcp");
		expect(get.status).toBe(405);
		expect(get.headers.get("allow")).toBe("POST");

		const json = await app.fetch("http://localhost/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		});
		expect(json.status).toBe(400);
		expect((await json.json()).error.code).toBe(-32700);
	});

	test("generated tool names", () => {
		expect(Route.get("/").describe("Home").tool?.name).toBe("get_index");
		expect(
			Route.post("/posts/:id/delete").describe("Delete a post").tool?.name,
		).toBe("post_posts_id_delete");
		expect(Route.get("/files/*").describe("Files").tool?.name).toBe(
			"get_files_wildcard",
		);
	});

	test("only described routes are tools", async () => {
		const { app, rpc } = setup();
		let called = false;
		app.use(
			Route.post("/undescribed")
				.fields({ text: Field.text() })
				.use(() => {
					called = true;
				}),
		);

		const { body } = await rpc("tools/list");
		expect(
			body.result.tools.map((tool: { name: string }) => tool.name),
		).not.toContain("post_undescribed");
		await rpc("tools/call", { name: "post_undescribed", arguments: {} });
		expect(called).toBe(false);

		// pages are resources, not tools
		expect(Route.post("/internal").tool).toBeUndefined();
		expect(
			Route.get("/search").fields({ q: Field.search() }).tool,
		).toBeUndefined();
		expect(Route.get("/about").tool).toBeUndefined();
	});
});
