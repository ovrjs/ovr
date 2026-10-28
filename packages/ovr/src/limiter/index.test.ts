import { App } from "../app/index.js";
import { Route } from "../route/index.js";
import { Limiter } from "./index.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(options: Limiter.Options = {}) {
	const limiter = new Limiter(options);
	const hit = vi.fn();
	const app = new App().use(
		Route.get("/limited", limiter.middleware, (c) => {
			hit();
			c.text("ok");
		}),
		Route.get("/health", (c) => c.text("ok")),
	);
	const fetch = (ip = "192.0.2.1", headers: HeadersInit = {}) =>
		app.fetch("https://example.com/limited", { ip, headers });
	return { app, limiter, fetch, hit };
}

describe("token buckets", () => {
	test("defaults to a burst of 60 and refills continuously without a window-boundary burst", async () => {
		const state = setup();
		for (let i = 0; i < 60; i++) expect((await state.fetch()).status).toBe(200);
		const denied = await state.fetch();
		expect(denied.status).toBe(429);
		expect(denied.headers.get("retry-after")).toBe("1");
		await vi.advanceTimersByTimeAsync(999);
		expect((await state.fetch()).status).toBe(429);
		await vi.advanceTimersByTimeAsync(1);
		expect((await state.fetch()).status).toBe(200);
		expect((await state.fetch()).status).toBe(429);
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
		const limiter = new Limiter({
			limit: 1,
			key: (c) => c.req.headers.get("key") ?? undefined,
		});
		const app = new App().use(
			Route.get("/", async (c) => {
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

	test("capacity refusal preserves existing buckets, and expired buckets are reclaimed", async () => {
		const state = setup({ limit: 1, interval: 1000, capacity: 1 });
		expect((await state.fetch()).status).toBe(200);
		expect((await state.fetch("192.0.2.2")).status).toBe(503);
		expect((await state.fetch()).status).toBe(429);
		await vi.advanceTimersByTimeAsync(1000);
		expect((await state.fetch("192.0.2.2")).status).toBe(200);
	});

	test.each([
		{ limit: 0 },
		{ limit: NaN },
		{ interval: 0 },
		{ interval: Infinity },
		{ capacity: -1 },
		{ name: "" },
	])("rejects invalid policies: %j", (options) => {
		expect(() => new Limiter(options)).toThrow("Invalid limiter");
	});
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

	test.each([
		"invalid",
		"192.0.2.1, 192.0.2.2",
		"127.0.0.999",
		"2001:db8:::1",
		"https://192.0.2.1",
		"user@example.com",
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

test("separate workers call a shared atomic store with stable keys and policy", async () => {
	const entries = new Set<string>();
	const consume = vi.fn(async (key: string, _policy: Limiter.Policy) => {
		if (entries.has(key)) return Date.now() + 60000;
		entries.add(key);
		return true;
	});
	const first = setup({ name: "search", consume });
	const second = setup({ name: "search", consume });
	expect((await first.fetch()).status).toBe(200);
	expect((await second.fetch()).status).toBe(429);
	expect(consume.mock.calls[0]?.[0]).toBe(consume.mock.calls[1]?.[0]);
	expect(consume.mock.calls[0]?.[1]).toEqual({ limit: 60, interval: 60000 });
});

test("shared storage errors and malformed results fail closed", async () => {
	const state = setup({ consume: async () => NaN });
	expect((await state.fetch()).status).toBe(503);
	const failed = setup({
		consume: async () => {
			throw new Error("private storage details");
		},
	});
	const response = await failed.fetch();
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private storage");
	// @ts-expect-error A backend must explicitly report admission; a forgotten return is rejected.
	const empty = setup({ consume: async () => undefined });
	expect((await empty.fetch()).status).toBe(503);
});
