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
		.params({ id: Schema.string().preprocess(String) })
		.use((c) => {
			const title = posts.get(c.params.id);
			if (!title) return c.text("Not Found", 404);
			return jsx("main", { children: jsx("h1", { children: title }) });
		});

	const search = Route.get("/search")
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
		.describe("Delete a post", { name: "delete_post", destructive: true })
		.use((c) => {
			if (!posts.delete(c.params.id)) return c.text("Not Found", 404);
			return c.redirect(list, 303);
		});

	const hidden = Route.post("/internal")
		.describe(false)
		.use(() => "secret");

	const app = new App().use(
		new Mcp({ name: "posts", version: "2.0.0", instructions: "Manage posts." }),
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
	test("a wildcard argument cannot change the request's origin", async () => {
		const { app, rpc } = setup();
		const origins: string[] = [];
		app.use(
			Route.post("/*")
				.describe("Catch all", { name: "catch_all" })
				.use((c) => {
					origins.push(c.url.origin);
					return "ok";
				}),
		);
		await rpc("tools/call", {
			name: "catch_all",
			arguments: { wildcard: "/other.example/private" },
		});
		expect(origins).not.toContain("http://other.example");
	});
	test("a cached tool cannot run after the route is hidden", async () => {
		const { app, rpc } = setup();
		let called = false;
		const route = Route.post("/toggle").use(() => {
			called = true;
		});
		app.use(route);
		await rpc("tools/list");
		route.describe(false);
		await rpc("tools/call", { name: "post_toggle" });
		expect(called).toBe(false);
	});
	test("mounting a service twice cannot switch the first endpoint to another app", async () => {
		const mcp = new Mcp();
		const first = new App().use(
			mcp,
			Route.get("/tenant").use(() => "first tenant"),
		);
		try {
			new App().use(
				mcp,
				Route.get("/tenant").use(() => "second tenant"),
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

	test("resources/read does not run hidden GET handlers", async () => {
		const { app, rpc } = setup();
		let called = false;
		app.use(
			Route.get("/private")
				.describe(false)
				.use(() => {
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
					.describe("Edit one item", { name: "edit_item" })
					.use(() => "edited"),
				Route.post("/edit/private")
					.describe(false)
					.use(() => {
						called = true;
					}),
				Route.post("/")
					.describe(false)
					.use(() => {
						called = true;
					}),
			);
			await rpc("tools/call", { name: "edit_item", arguments: { id } });
			expect(called).toBe(false);
		},
	);

	test("a tool redirect cannot fetch a hidden resource", async () => {
		const { app, rpc } = setup();
		let called = false;
		app.use(
			Route.post("/go").use((c) => c.redirect("/private", 303)),
			Route.get("/private")
				.describe(false)
				.use(() => {
					called = true;
				}),
		);
		await rpc("tools/call", { name: "post_go" });
		expect(called).toBe(false);
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
			Route.get("/slow").use(async (c) => {
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
					version: "2.0.0",
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
			"get_search",
			"post_posts",
			"delete_post",
		]);
		expect(body.result).toMatchObject({ ttlMs: 60000, cacheScope: "public" });

		const [list, search, create, remove] = tools;

		expect(list).toEqual({
			name: "get_posts",
			description: "List posts",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true, openWorldHint: false },
		});
		expect(search.description).toBe("GET /search");
		expect(Object.keys(search.inputSchema.properties)).toEqual(["q"]);
		expect(create.inputSchema.properties.title).toMatchObject({ minLength: 3 });
		expect(create.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		});
		expect(remove.inputSchema).toEqual({
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		});
		expect(remove.annotations.destructiveHint).toBe(true);
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
			name: "delete_post",
			arguments: {},
		});
		expect(missing.body.result).toMatchObject({
			isError: true,
			content: [{ text: "Missing required parameter: id" }],
		});

		const gone = await rpc("tools/call", {
			name: "delete_post",
			arguments: { id: "9" },
		});
		expect(gone.body.result.isError).toBe(true);
		expect(gone.body.result.content[0].text).toContain("404");

		await rpc("tools/call", { name: "delete_post", arguments: { id: "1" } });
		expect(posts.has("1")).toBe(false);

		const search = await rpc("tools/call", {
			name: "get_search",
			arguments: { q: "ovr" },
		});
		expect(search.body.result.content[0].text).toBe("Results for ovr\n");

		const unknown = await rpc("tools/call", { name: "nope", arguments: {} });
		expect(unknown.body.error.code).toBe(-32602);
	});

	test("pages are resources", async () => {
		const { rpc } = setup();

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
				mimeType: "text/markdown",
			},
		]);

		const templates = await rpc("resources/templates/list");
		expect(templates.body.result.resourceTemplates).toEqual([
			{
				uriTemplate: "http://localhost/posts/{id}",
				name: "/posts/:id",
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

	test("two routes cannot share a tool name", async () => {
		const { app, rpc } = setup();
		app.use(
			Route.post("/archive").describe("Archive", { name: "delete_post" }),
		);
		await expect(rpc("tools/list")).rejects.toThrow(/"delete_post"/);
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
		expect(Route.post("/posts/:id/delete").tool?.name).toBe(
			"post_posts_id_delete",
		);
		expect(Route.get("/files/*").describe("Files").tool?.name).toBe(
			"get_files_wildcard",
		);
		// pages are resources, not tools
		expect(Route.get("/about").tool).toBeUndefined();
		expect(Route.post("/hidden").describe(false).tool).toBeUndefined();
	});
});
