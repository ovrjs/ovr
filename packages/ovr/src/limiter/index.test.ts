import { App } from "../app/index.js";
import { Database, owned } from "../database/index.js";
import { Mcp } from "../mcp/index.js";
import { Route } from "../route/index.js";
import { Codec } from "../util/index.js";
import { LimitIssue, Limiter } from "./index.js";
import { PGlite } from "@electric-sql/pglite";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

const engine = await PGlite.create();
const db = new Database(
	{
		query: async (text, values) =>
			values?.length
				? engine.query(text, values)
				: ((await engine.exec(text)).at(-1) ?? { rows: [] }),
		connect: () => {
			throw new Error("Limiter does not use transactions");
		},
	},
	[Limiter.table],
);
await engine.exec(owned.get(Limiter.table)![0]!.sql);

/** Database whose queries fail, as when Postgres is unavailable. */
const broken = (failure: Error) =>
	new Database(
		{
			query: async () => {
				throw failure;
			},
			connect: async () => {
				throw failure;
			},
		},
		[Limiter.table],
	);

// only Date, PGlite needs real timers
beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	await engine.exec("TRUNCATE rate_limits");
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
afterAll(() => engine.close());

function setup({
	name = "requests",
	...options
}: Partial<Limiter.Options> & { name?: string } = {}) {
	const limiter = new Limiter(name, { database: db, ...options });
	const hit = vi.fn();
	const app = new App().use(
		Route.get("/limited").use(limiter.middleware, (c) => {
			hit();
			c.text("ok");
		}),
		Route.get("/health").use((c) => c.text("ok")),
	);
	const fetch = (ip = "192.0.2.1", headers: HeadersInit = {}) =>
		app.fetch("https://example.com/limited", { ip, headers });
	return { app, limiter, fetch, hit };
}

/** The key a bucket is stored under, a hash of its policy, scope, and identity */
const key = async (...parts: unknown[]) =>
	Codec.Base64Url.encode(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				Codec.encode(JSON.stringify(parts)),
			),
		),
	);

const buckets = () =>
	db.sql`SELECT * FROM ${db.rate_limits} ORDER BY key`.parse(db.rate_limits);

describe("token buckets", () => {
	test("supplies the default policy and refills continuously", async () => {
		const state = setup();
		for (let i = 0; i < 60; i++) expect((await state.fetch()).status).toBe(200);
		const denied = await state.fetch();
		expect(denied.status).toBe(429);
		// 60 a minute refills one token a second
		expect(denied.headers.get("retry-after")).toBe("1");
		vi.advanceTimersByTime(1000);
		expect((await state.fetch()).status).toBe(200);
		expect((await state.fetch()).status).toBe(429);
		expect(state.hit).toHaveBeenCalledTimes(61);
		const [bucket] = await buckets();
		expect(bucket!.key).toBe(await key("requests", 60, 60000, "", "192.0.2.1"));
	});

	test("concurrent checks consume one budget", async () => {
		const state = setup({ limit: 3 });
		const responses = await Promise.all(
			Array.from({ length: 20 }, () => state.fetch()),
		);
		expect(responses.filter((v) => v.status === 200)).toHaveLength(3);
		expect(state.hit).toHaveBeenCalledTimes(3);
	});

	test("unrelated clients and routes retain their budgets", async () => {
		const state = setup({ limit: 1 });
		expect((await state.fetch()).status).toBe(200);
		expect((await state.fetch()).status).toBe(429);
		expect((await state.fetch("192.0.2.2")).status).toBe(200);
		expect((await state.app.fetch("https://example.com/health")).status).toBe(
			200,
		);
	});

	test("a 1024-character Unicode identity can consume and exhaust a bucket", async () => {
		const key = Array.from({ length: 1024 }, (_, i) =>
			String.fromCharCode(0x4e00 + ((i * 7919) % 20000)),
		).join("");
		const { fetch } = setup({ limit: 1, key: () => key });
		expect((await fetch()).status).toBe(200);
		expect((await fetch()).status).toBe(429);
	});

	test("scopes have independent budgets", async () => {
		const { limiter } = setup({
			limit: 1,
			key: (c) => c.req.headers.get("key") ?? undefined,
		});
		const app = new App().use(
			Route.get("/").use(async (c) => {
				c.json([
					await limiter.check(c, "options"),
					await limiter.check(c, "verify"),
					await limiter.check(c, "options"),
				]);
			}),
		);
		const response = await app.fetch("https://example.com", {
			headers: { key: "a:verify" },
		});
		const result: unknown[] = await response.json();
		expect(result.slice(0, 2)).toEqual([true, true]);
		expect(typeof result[2]).toBe("string");
	});

	test("expired buckets start full and are pruned", async () => {
		const state = setup({ limit: 1, interval: 1000 });
		expect((await state.fetch()).status).toBe(200);
		expect((await state.fetch()).status).toBe(429);
		vi.advanceTimersByTime(61000);
		expect((await state.fetch("192.0.2.2")).status).toBe(200);
		// the first client's expired bucket was pruned
		expect((await buckets()).map((bucket) => bucket.key)).toEqual([
			await key("requests", 1, 1000, "", "192.0.2.2"),
		]);
		expect((await state.fetch()).status).toBe(200);
	});
});

test("a limiter needs a database", () => {
	// type errors, never run
	void (() => {
		// @ts-expect-error A database is required, including for the default policy.
		new Limiter("requests");
		// @ts-expect-error A policy without storage is not a valid limiter configuration.
		new Limiter("requests", { limit: 10 });
	});
});

describe("trusted identities", () => {
	test("missing metadata throws even when the request supplies IP headers", async () => {
		const state = setup();
		await expect(
			state.app.fetch("https://example.com/limited", {
				headers: {
					"x-forwarded-for": "192.0.2.1",
					"cf-connecting-ip": "192.0.2.1",
				},
			}),
		).rejects.toThrow(LimitIssue);
		expect(state.hit).not.toHaveBeenCalled();
	});

	test("rotated and differently formatted IPv6 addresses in one /64 share a budget", async () => {
		const state = setup({ limit: 1 });
		expect((await state.fetch("2001:db8:1234:abcd::1")).status).toBe(200);
		expect(
			(await state.fetch("2001:0DB8:1234:ABCD:FFFF:1234:5678:abcd")).status,
		).toBe(429);
		expect((await state.fetch("2001:db8:1234:abce::1")).status).toBe(200);
	});

	test("IPv4-mapped addresses share the corresponding IPv4 bucket", async () => {
		const state = setup({ limit: 1 });
		expect((await state.fetch("192.0.2.1")).status).toBe(200);
		expect((await state.fetch("::ffff:192.0.2.1")).status).toBe(429);
		expect((await state.fetch("::ffff:c000:201")).status).toBe(429);
		expect((await state.fetch("::ffff:192.0.2.2")).status).toBe(200);
	});

	test("groups IPv6 addresses by /64 network", async () => {
		const state = setup({ limit: 1 });
		expect((await state.fetch("2001:db8:1234:abcd::1")).status).toBe(200);
		expect((await state.fetch("2001:0DB8:1234:ABCD::2")).status).toBe(429);
		expect((await state.fetch("2001:db8:1234:abce::1")).status).toBe(200);
	});

	test.each([
		"invalid",
		"192.0.2.1, 192.0.2.2",
		"127.0.0.999",
		"2001:db8:::1",
		"https://192.0.2.1",
		"user@example.com",
		"010.1.1.1",
		"192.0.02.1",
		"127.1",
	])("rejects malformed peer metadata: %s", async (ip) => {
		await expect(setup().fetch(ip)).rejects.toThrow(LimitIssue);
	});

	test("authenticated keys can replace IP identity", async () => {
		const state = setup({ limit: 1, key: async () => "verified-user" });
		expect((await state.app.fetch("https://example.com/limited")).status).toBe(
			200,
		);
		expect((await state.fetch("192.0.2.2")).status).toBe(429);
	});
});

test("different policies with the same name cannot share token balances", async () => {
	const first = setup({ limit: 1 });
	const second = setup({ limit: 2 });
	const third = setup({ limit: 1, interval: 120000 });
	expect((await first.fetch()).status).toBe(200);
	expect((await first.fetch()).status).toBe(429);
	expect((await second.fetch()).status).toBe(200);
	expect((await second.fetch()).status).toBe(200);
	expect((await second.fetch()).status).toBe(429);
	expect((await third.fetch()).status).toBe(200);
	expect(await buckets()).toHaveLength(3);
});

test("retry deadlines round up and stay between one second and one hour", async () => {
	const fractional = setup({ name: "fractional", limit: 1, interval: 2500 });
	expect((await fractional.fetch()).status).toBe(200);
	expect((await fractional.fetch()).headers.get("retry-after")).toBe("3");
	const slow = setup({ name: "slow", limit: 1, interval: 2 * 3600000 });
	expect((await slow.fetch()).status).toBe(200);
	expect((await slow.fetch()).headers.get("retry-after")).toBe("3600");
	expect(fractional.hit).toHaveBeenCalledOnce();
	expect(slow.hit).toHaveBeenCalledOnce();
});

test("middleware throws storage failures to the app without admitting requests", async () => {
	const failure = new Error("private storage details");
	const state = setup({ database: broken(failure) });
	await expect(state.fetch()).rejects.toBe(failure);
	expect(state.hit).not.toHaveBeenCalled();
});

test("limiters with different names and the same policy keep separate buckets", async () => {
	const pages = setup({ name: "pages", limit: 1 });
	const search = setup({ name: "search", limit: 1 });
	expect((await pages.fetch()).status).toBe(200);
	expect((await search.fetch()).status).toBe(200);
	expect((await pages.fetch()).status).toBe(429);
	expect(await buckets()).toHaveLength(2);
});

test("separate workers share buckets through the database", async () => {
	const first = setup({ name: "search", limit: 1 });
	const second = setup({ name: "search", limit: 1 });
	expect((await first.fetch()).status).toBe(200);
	expect((await second.fetch()).status).toBe(429);
	expect(await buckets()).toHaveLength(1);
});

test("an agent's tool call is one request to the app, counted once by each limiter", async () => {
	const everywhere = new Limiter("everywhere", { database: db, limit: 2 });
	const expensive = new Limiter("expensive", { database: db, limit: 1 });
	const app = new App().use(
		everywhere.middleware,
		Route.get("/cheap")
			.describe("Cheap")
			.use((c) => c.text("cheap")),
		Route.get("/expensive")
			.describe("Expensive")
			.use(expensive.middleware, (c) => c.text("expensive")),
		new Mcp({ name: "limits" }),
	);
	const version = "2026-07-28";
	const call = async (name: string, ip: string) => {
		const res = await app.fetch("https://example.com/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"mcp-protocol-version": version,
				"mcp-method": "tools/call",
				"mcp-name": name,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name,
					arguments: {},
					_meta: {
						"io.modelcontextprotocol/protocolVersion": version,
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
			ip,
		});

		return res.status === 200
			? ((await res.json()) as any).result.content[0].text
			: res.status;
	};

	// the global limit of 2 allows two calls: the endpoint is outside the
	// app's middleware, and its request to the route is the one counted. The
	// third is refused as the route would refuse a person, which the agent reads
	expect(await call("get_cheap", "192.0.2.10")).toBe("cheap");
	expect(await call("get_cheap", "192.0.2.10")).toBe("cheap");
	expect(await call("get_cheap", "192.0.2.10")).toContain("429");

	// a route's own limiter still counts the call, once, and says when to retry
	expect(await call("get_expensive", "192.0.2.20")).toBe("expensive");
	expect(await call("get_expensive", "192.0.2.20")).toMatch(
		/^429\n\nRetry after \d+ seconds\n\nToo many requests/,
	);

	// neither the endpoint's own requests nor its refusals are the app's to count
	const list = await app.fetch("https://example.com/mcp", { method: "GET" });
	expect(list.status).toBe(405);

	// and a person's request is counted as before
	const page = () =>
		app.fetch("https://example.com/cheap", { ip: "192.0.2.30" });
	expect((await page()).status).toBe(200);
	expect((await page()).status).toBe(200);
	expect((await page()).status).toBe(429);
});

test("a write that redirects is done, though the page it sends to is refused", async () => {
	const todos: string[] = [];
	// as for a person's browser, the form's request and the page's are two
	const everywhere = new Limiter("redirects", { database: db, limit: 3 });
	const app = new App().use(
		everywhere.middleware,
		Route.get("/list")
			.describe("List")
			.use((c) => c.text(todos.join())),
		Route.post("/add")
			.describe("Add")
			.use((c) => {
				todos.push(`t${todos.length}`);
				c.redirect("/list", 303);
			}),
		new Mcp({ name: "todos" }),
	);
	const version = "2026-07-28";
	const add = async () =>
		(
			(await (
				await app.fetch("https://example.com/mcp", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"mcp-protocol-version": version,
						"mcp-method": "tools/call",
						"mcp-name": "post_add",
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: {
							name: "post_add",
							arguments: {},
							_meta: {
								"io.modelcontextprotocol/protocolVersion": version,
								"io.modelcontextprotocol/clientCapabilities": {},
							},
						},
					}),
					ip: "192.0.2.40",
				})
			).json()) as any
		).result;

	expect(await add()).toMatchObject({
		isError: false,
		content: [{ type: "text", text: "Redirected to /list\n\nt0" }],
	});

	// the third request is the second write, the fourth is its page: the
	// write happened, so the call is not an error an agent would retry
	const second = await add();
	expect(todos).toEqual(["t0", "t1"]);
	expect(second.isError).toBe(false);
	expect(second.content[0].text).toMatch(
		/^Redirected to \/list, which could not be read: 429\n\nRetry after \d+ seconds$/,
	);
});
