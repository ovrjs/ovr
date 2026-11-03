import { App } from "../app/index.js";
import { Database } from "../database/index.js";
import { Route } from "../route/index.js";
import { Limiter } from "./index.js";
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
await engine.exec(Limiter.sql[1]);

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
		[],
	);

// only Date, PGlite needs real timers
beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	// failures are logged
	vi.spyOn(console, "error").mockImplementation(() => {});
	await engine.exec("TRUNCATE rate_limits");
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
afterAll(() => engine.close());

function setup(options: Partial<Limiter.Options> = {}) {
	const limiter = new Limiter({ database: db, ...options });
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
		expect(JSON.parse(bucket!.key)).toEqual([
			"requests",
			60,
			60000,
			"",
			"192.0.2.1",
		]);
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
		expect(
			(await buckets()).map((bucket) => JSON.parse(bucket.key)[4]),
		).toEqual(["192.0.2.2"]);
		expect((await state.fetch()).status).toBe(200);
	});

	test.each([
		{ limit: 0 },
		{ limit: NaN },
		{ interval: 0 },
		{ interval: Infinity },
		{ name: "" },
	])("rejects invalid policies: %j", (options) => {
		expect(() => setup(options)).toThrow("Invalid limiter");
	});
});

test("a missing database fails at startup instead of allocating local counters", () => {
	// @ts-expect-error A database is required, including for the default policy.
	expect(() => new Limiter()).toThrow("database");
	// @ts-expect-error A policy without storage is not a valid limiter configuration.
	expect(() => new Limiter({ limit: 10 })).toThrow("database");
});

describe("trusted identities", () => {
	test("missing metadata fails closed even when the request supplies IP headers", async () => {
		const state = setup();
		const response = await state.app.fetch("https://example.com/limited", {
			headers: {
				"x-forwarded-for": "192.0.2.1",
				"cf-connecting-ip": "192.0.2.1",
			},
		});
		expect(response.status).toBe(503);
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
		expect((await setup().fetch(ip)).status).toBe(503);
	});

	test("authenticated keys can replace IP identity", async () => {
		const state = setup({ limit: 1, key: async () => "verified-user" });
		expect((await state.app.fetch("https://example.com/limited")).status).toBe(
			200,
		);
		expect((await state.fetch("192.0.2.2")).status).toBe(429);
	});
});

test("different policies using the default namespace cannot share token balances", async () => {
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

test("middleware logs failures without exposing them or admitting requests", async () => {
	const failure = new Error("private storage details");
	const state = setup({ database: broken(failure) });
	const response = await state.fetch();
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private storage");
	expect(console.error).toHaveBeenCalledWith(failure);
	expect(state.hit).not.toHaveBeenCalled();
});

test("separate workers share buckets through the database", async () => {
	const first = setup({ name: "search", limit: 1 });
	const second = setup({ name: "search", limit: 1 });
	expect((await first.fetch()).status).toBe(200);
	expect((await second.fetch()).status).toBe(429);
	expect(await buckets()).toHaveLength(1);
});
