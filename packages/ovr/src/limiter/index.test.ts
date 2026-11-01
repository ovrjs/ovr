import { App } from "../app/index.js";
import { Route } from "../route/index.js";
import { Limiter } from "./index.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(options: Partial<Limiter.Options> = {}) {
	// Test-only shared-store stand-in. The library always calls the supplied backend.
	const counts = new Map<string, number>();
	const consume = vi.fn(
		(key: string, { limit, interval }: Limiter.Policy): true | number => {
			const count = counts.get(key) ?? 0;
			if (count >= limit) return Date.now() + interval;
			counts.set(key, count + 1);
			return true;
		},
	);
	const limiter = new Limiter({ consume, error: vi.fn(), ...options });
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
	return { app, limiter, fetch, hit, consume };
}

describe("token buckets", () => {
	test("supplies the default policy and consults shared storage on every request", async () => {
		const state = setup();
		state.consume
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(Date.now() + 17501)
			.mockReturnValueOnce(true);
		expect((await state.fetch()).status).toBe(200);
		const denied = await state.fetch();
		expect(denied.status).toBe(429);
		expect(denied.headers.get("retry-after")).toBe("18");
		expect((await state.fetch()).status).toBe(200);
		expect(state.consume).toHaveBeenCalledTimes(3);
		expect(state.consume.mock.calls.map((call) => call[0])).toEqual(
			Array(3).fill(state.consume.mock.calls[0]?.[0]),
		);
		expect(state.consume.mock.calls[0]?.[1]).toEqual({
			limit: 60,
			interval: 60000,
		});
		expect(state.hit).toHaveBeenCalledTimes(2);
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

	test.each([
		{ limit: 0 },
		{ limit: NaN },
		{ interval: 0 },
		{ interval: Infinity },
		{ name: "" },
		{ prefix: 0 },
		{ prefix: 129 },
		{ prefix: 48.5 },
	])("rejects invalid policies: %j", (options) => {
		expect(() => setup(options)).toThrow("Invalid limiter");
	});
});

test("missing shared storage fails at startup instead of allocating local counters", () => {
	// @ts-expect-error A shared backend is required, including for the default policy.
	expect(() => new Limiter()).toThrow("consume");
	// @ts-expect-error A policy without storage is not a valid limiter configuration.
	expect(() => new Limiter({ limit: 10 })).toThrow("consume");
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

	test.each([48, 53, 56, 128])("supports IPv6 /%i grouping", async (prefix) => {
		const state = setup({ limit: 1, prefix });
		expect((await state.fetch("2001:db8:1234:abcd::1")).status).toBe(200);
		expect((await state.fetch("2001:0DB8:1234:ABCD::1")).status).toBe(429);
		expect((await state.fetch("2001:db8:1234:abce::1")).status).toBe(
			prefix === 128 ? 200 : 429,
		);
		expect((await state.fetch("2001:db8:1235:abcd::1")).status).toBe(200);
	});

	test("masks partial IPv6 groups at the exact prefix boundary", async () => {
		const state = setup({ limit: 1, prefix: 53 });
		expect((await state.fetch("2001:db8:1234:a800::1")).status).toBe(200);
		expect((await state.fetch("2001:db8:1234:afff::2")).status).toBe(429);
		expect((await state.fetch("2001:db8:1234:b000::1")).status).toBe(200);
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
	const second = setup({ limit: 2, consume: first.consume });
	const third = setup({ limit: 1, interval: 120000, consume: first.consume });
	expect((await first.fetch()).status).toBe(200);
	expect((await first.fetch()).status).toBe(429);
	expect((await second.fetch()).status).toBe(200);
	expect((await second.fetch()).status).toBe(200);
	expect((await second.fetch()).status).toBe(429);
	expect((await third.fetch()).status).toBe(200);
	expect(new Set(first.consume.mock.calls.map(([key]) => key)).size).toBe(3);
});

test("fractional retry deadlines round up, while numeric one still denies", async () => {
	const state = setup();
	state.consume.mockReturnValueOnce(Date.now() + 1234.5).mockReturnValueOnce(1);
	const response = await state.fetch();
	expect(response.status).toBe(429);
	expect(response.headers.get("retry-after")).toBe("2");
	const denied = await state.fetch();
	expect(denied.status).toBe(429);
	expect(denied.headers.get("retry-after")).toBe("1");
	expect(state.hit).not.toHaveBeenCalled();
});

test("middleware reports failures without exposing them or admitting requests", async () => {
	const error = vi.fn();
	const failure = new Error("private storage details");
	const state = setup({
		consume: () => {
			throw failure;
		},
		error,
	});
	const response = await state.fetch();
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private storage");
	expect(error).toHaveBeenCalledWith(
		failure,
		expect.objectContaining({ ip: "192.0.2.1" }),
	);
	expect(state.hit).not.toHaveBeenCalled();
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const fallback = new App().use(
			new Limiter({
				consume: () => {
					throw failure;
				},
			}).middleware,
		);
		expect(
			(await fallback.fetch("https://example.com", { ip: "192.0.2.1" })).status,
		).toBe(503);
		expect(log).toHaveBeenCalledWith(failure);
		error.mockRejectedValue(new Error("logger unavailable"));
		expect((await state.fetch()).status).toBe(503);
		expect(log).toHaveBeenCalledWith(
			expect.objectContaining({ message: "logger unavailable" }),
		);
	} finally {
		log.mockRestore();
	}
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
