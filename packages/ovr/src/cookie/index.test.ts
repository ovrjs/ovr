import { Cookie } from "./index.js";
import { describe, expect, test, vi } from "vitest";

// Mocking the Context interface based on usage in the Cookie class
const createMockContext = (cookieHeader: string | null = null) => {
	const appendSpy = vi.fn();

	return {
		ctx: {
			req: {
				headers: {
					get: (key: string) => {
						if (key.toLowerCase() === "cookie") return cookieHeader;
						return null;
					},
				},
			},
			res: { headers: { append: appendSpy } },
		} as any, // Cast to any to bypass exact Context type matching
		appendSpy,
	};
};

describe("Cookie Manager", () => {
	describe("get() - Parsing Logic", () => {
		test("parses a simple key-value pair", () => {
			const { ctx } = createMockContext("foo=bar");
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("bar");
		});

		test("parses multiple cookies separated by semicolon and space", () => {
			const { ctx } = createMockContext("foo=bar; baz=qux; num=123");
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("bar");
			expect(cookie.get("baz")).toBe("qux");
			expect(cookie.get("num")).toBe("123");
		});

		test("parses multiple cookies with tight spacing (no space after semi)", () => {
			const { ctx } = createMockContext("foo=bar;baz=qux");
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("bar");
			expect(cookie.get("baz")).toBe("qux");
		});

		test("handles quoted values by stripping quotes", () => {
			const { ctx } = createMockContext('foo="bar"; baz="hello world"');
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("bar");
			expect(cookie.get("baz")).toBe("hello world");
		});

		test("decodes URI encoded values", () => {
			const { ctx } = createMockContext("foo=hello%20world; bar=%F0%9F%9A%80");
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("hello world");
			expect(cookie.get("bar")).toBe("🚀");
		});

		test("returns raw value if decoding fails", () => {
			// Malformed URI sequence
			const badVal = "foo=%E0%A4%A";
			const { ctx } = createMockContext(badVal);
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("%E0%A4%A");
		});

		test("prioritizes the first occurrence of a key", () => {
			// RFC 6265 suggests reliance on the first match if multiple exist
			const { ctx } = createMockContext("foo=first; foo=second");
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("first");
		});

		test("returns undefined for missing keys", () => {
			const { ctx } = createMockContext("foo=bar");
			const cookie = new Cookie(ctx);
			expect(cookie.get("missing")).toBeUndefined();
		});

		test("handles empty values correctly", () => {
			const { ctx } = createMockContext("foo=; bar=");
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBe("");
			expect(cookie.get("bar")).toBe("");
		});

		test("handles no cookie header", () => {
			const { ctx } = createMockContext(null);
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBeUndefined();
		});

		test("ignores malformed cookies (no equals sign)", () => {
			const { ctx } = createMockContext("foo; bar=baz");
			const cookie = new Cookie(ctx);
			expect(cookie.get("foo")).toBeUndefined();
			expect(cookie.get("bar")).toBe("baz");
		});

		test("recovers from malformed separators (equal > semi logic)", () => {
			// This tests the specific logic: if (equal > semi)
			// e.g., "malformed;cookie=val" where the first part lacks an equals
			const { ctx } = createMockContext("bad;good=value");
			const cookie = new Cookie(ctx);
			expect(cookie.get("good")).toBe("value");
		});
	});

	describe("set() - Header Generation", () => {
		test("sets a basic cookie with defaults", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);

			cookie.set("session", "123");

			expect(appendSpy).toHaveBeenCalledWith(
				"set-cookie",
				"session=123; Path=/",
			);
		});

		test("encodes values", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);

			cookie.set("user", "John Doe");

			expect(appendSpy).toHaveBeenCalledWith(
				"set-cookie",
				"user=John%20Doe; Path=/",
			);
		});

		test("applies domain and path options", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);

			cookie.set("auth", "token", { domain: "example.com", path: "/admin" });

			expect(appendSpy).toHaveBeenCalledWith(
				"set-cookie",
				"auth=token; Path=/admin; Domain=example.com",
			);
		});

		test("applies Max-Age and Expires", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);
			const date = new Date("2024-01-01T00:00:00Z");

			cookie.set("data", "val", { maxAge: 3600, expires: date });

			expect(appendSpy).toHaveBeenCalledWith(
				"set-cookie",
				"data=val; Path=/; Max-Age=3600; Expires=Mon, 01 Jan 2024 00:00:00 GMT",
			);
		});

		test("applies security flags (HttpOnly, Secure, Partitioned)", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);

			cookie.set("id", "1", {
				httpOnly: true,
				secure: true,
				partitioned: true,
			});

			const callArgs = appendSpy.mock.calls[0][1];
			expect(callArgs).toContain("HttpOnly");
			expect(callArgs).toContain("Secure");
			expect(callArgs).toContain("Partitioned");
		});

		test("applies SameSite and Priority", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);

			cookie.set("id", "1", {
				sameSite: "Strict",
				priority: "High",
				secure: true,
			});

			const callArgs = appendSpy.mock.calls[0][1];
			expect(callArgs).toContain("SameSite=Strict");
			expect(callArgs).toContain("Priority=High");
		});
	});

	describe("delete()", () => {
		test("sets the cookie to empty and Max-Age 0", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);

			cookie.set("session", "", { maxAge: 0 });

			expect(appendSpy).toHaveBeenCalledWith(
				"set-cookie",
				"session=; Path=/; Max-Age=0",
			);
		});

		test("respects domain and path when deleting", () => {
			const { ctx, appendSpy } = createMockContext();
			const cookie = new Cookie(ctx);

			cookie.set("session", "", {
				path: "/app",
				domain: "sub.example.com",
				maxAge: 0,
			});

			expect(appendSpy).toHaveBeenCalledWith(
				"set-cookie",
				"session=; Path=/app; Domain=sub.example.com; Max-Age=0",
			);
		});
	});
});
