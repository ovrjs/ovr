import { App } from "../app/index.js";
import { Route } from "../route/index.js";
import { Time } from "../util/index.js";
import type { Auth } from "./index.js";
import { describe, expect, test } from "vitest";

const TEST_SECRET = "test-secret-key-for-testing-purposes-only";
const DIFFERENT_SECRET = "different-secret-key-for-testing-purposes";
const BASE_URL = "http://localhost:5173";

// Helper to parse Set-Cookie header
const parseCookie = (setCookie: string) => {
	const parts = setCookie.split("; ");
	const [nameValue, ...attributes] = parts;
	const [name, value] = nameValue.split("=", 2);

	const attrs: Record<string, string | boolean> = {};
	for (const attr of attributes) {
		const [key, val] = attr.split("=", 2);
		attrs[key.toLowerCase()] = val ?? true;
	}

	return { name, value: decodeURIComponent(value), attrs };
};

// Helper to extract payload from token
const extractPayload = (token: string) => {
	const [payloadB64] = token.split(".", 2);
	return JSON.parse(atob(payloadB64!)) as Auth.Session;
};

// Helper to get cookie value from Set-Cookie header
const getSessionCookie = (res: Response, cookieName = "__Host-session") => {
	const setCookie = res.headers.get("set-cookie");
	if (!setCookie) return null;
	const cookie = parseCookie(setCookie);
	if (cookie.name !== cookieName) return null;
	return cookie;
};

describe("Auth", () => {
	describe("login", () => {
		test("creates session with user ID and expiration", async () => {
			let session: Auth.Session | null = null;

			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					session = await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);

			expect(res.status).toBe(200);
			expect(session).not.toBeNull();
			expect(session!.id).toBe("user-123");
			expect(session!.expiration).toBeGreaterThan(Date.now());
		});

		test("sets cookie with correct token format (payload.signature)", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res);

			expect(cookie).not.toBeNull();
			const parts = cookie!.value.split(".");
			expect(parts).toHaveLength(2);
			expect(parts[0]).toBeTruthy(); // payload (base64)
			expect(parts[1]).toBeTruthy(); // signature (base64)
		});

		test("sets cookie with HttpOnly flag", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res);

			expect(cookie).not.toBeNull();
			expect(cookie!.attrs.httponly).toBe(true);
		});

		test("sets cookie with Secure flag by default", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res);

			expect(cookie).not.toBeNull();
			expect(cookie!.attrs.secure).toBe(true);
		});

		test("sets cookie with SameSite=Lax", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res);

			expect(cookie).not.toBeNull();
			expect(cookie!.attrs.samesite).toBe("Lax");
		});

		test("sets correct maxAge based on duration", async () => {
			const duration = Time.day;
			const app = new App({ auth: { secret: TEST_SECRET, duration } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res);

			expect(cookie).not.toBeNull();
			expect(cookie!.attrs["max-age"]).toBe(
				String(Math.floor(duration / 1000)),
			);
		});

		test("uses default duration of 1 week", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res);

			expect(cookie).not.toBeNull();
			expect(cookie!.attrs["max-age"]).toBe(
				String(Math.floor(Time.week / 1000)),
			);
		});

		test("session expiration matches duration", async () => {
			const duration = Time.hour * 2;
			let session: Auth.Session | null = null;

			const app = new App({ auth: { secret: TEST_SECRET, duration } }).use(
				Route.get("/login", async (c) => {
					session = await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const before = Date.now();
			await app.fetch(`${BASE_URL}/login`);
			const after = Date.now();

			expect(session).not.toBeNull();
			expect(session!.expiration).toBeGreaterThanOrEqual(before + duration);
			expect(session!.expiration).toBeLessThanOrEqual(after + duration);
		});
	});

	describe("session", () => {
		test("returns null when no cookie present", async () => {
			let session: Auth.Session | null | undefined;

			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/check", async (c) => {
					session = await c.auth.session();
					c.text("ok");
				}),
			);

			await app.fetch(`${BASE_URL}/check`);

			expect(session).toBeNull();
		});

		test("returns session when valid token exists", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			// First, login to get a session cookie
			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);
			expect(cookie).not.toBeNull();

			// Then check the session with that cookie
			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(session.id).toBe("user-123");
		});

		test("returns null and clears cookie on expired session", async () => {
			const app = new App({
				auth: { secret: TEST_SECRET, duration: 1 }, // 1ms duration
			}).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			// Login
			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);
			expect(cookie).not.toBeNull();

			// Wait for expiration
			await new Promise((r) => setTimeout(r, 10));

			// Check session - should be expired
			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).toBeNull();

			// Should have set a cookie to clear it
			const clearCookie = getSessionCookie(checkRes);
			expect(clearCookie).not.toBeNull();
			expect(clearCookie!.attrs["max-age"]).toBe("0");
		});

		test("does not refresh session when outside refresh threshold", async () => {
			const duration = Time.hour;
			const refresh = duration / 4;

			const app = new App({
				auth: { secret: TEST_SECRET, duration, refresh },
			}).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			// Login
			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			// Check immediately (well outside refresh threshold)
			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();

			// Should NOT have set a new cookie (no refresh needed)
			expect(checkRes.headers.get("set-cookie")).toBeNull();
		});
	});

	describe("logout", () => {
		test("returns null", async () => {
			let result: Auth.Session | null | undefined;

			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/logout", async (c) => {
					result = await c.auth.logout();
					c.text("ok");
				}),
			);

			await app.fetch(`${BASE_URL}/logout`);

			expect(result).toBeNull();
		});

		test("clears cookie by setting empty value and maxAge 0", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/logout", async (c) => {
					await c.auth.logout();
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/logout`);
			const cookie = getSessionCookie(res);

			expect(cookie).not.toBeNull();
			expect(cookie!.value).toBe("");
			expect(cookie!.attrs["max-age"]).toBe("0");
		});
	});

	describe("security - signature verification", () => {
		test("rejects tokens signed with different secret", async () => {
			// Create app with first secret
			const app1 = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			// Create app with different secret
			const app2 = new App({ auth: { secret: DIFFERENT_SECRET } }).use(
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			// Get token from app1
			const loginRes = await app1.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			// Try to use it with app2
			const checkRes = await app2.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).toBeNull();

			// Should clear the invalid cookie
			const clearCookie = getSessionCookie(checkRes);
			expect(clearCookie).not.toBeNull();
			expect(clearCookie!.attrs["max-age"]).toBe("0");
		});

		test("rejects tampered payload", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);
			const [, signature] = cookie!.value.split(".", 2);

			// Tamper with the payload - change the user ID
			const tamperedPayload = btoa(
				JSON.stringify({ id: "admin", expiration: Date.now() + Time.week }),
			);
			const tamperedToken = `${tamperedPayload}.${signature}`;

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${tamperedToken}` },
			});

			const session = await checkRes.json();
			expect(session).toBeNull();
		});

		test("rejects tampered signature", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);
			const [payload, signature] = cookie!.value.split(".", 2);

			// Tamper with signature
			const tamperedSignature = signature!.slice(0, -4) + "XXXX";
			const tamperedToken = `${payload}.${tamperedSignature}`;

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${tamperedToken}` },
			});

			const session = await checkRes.json();
			expect(session).toBeNull();
		});

		test("accepts valid signature", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(session.id).toBe("user-123");
		});
	});

	describe("security - token format", () => {
		test("rejects token without signature (missing dot)", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const invalidToken = btoa(
				JSON.stringify({ id: "user", expiration: Date.now() + 10000 }),
			);

			const res = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${invalidToken}` },
			});

			const session = await res.json();
			expect(session).toBeNull();
		});

		test("rejects token with invalid base64 payload", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const res = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=!!!invalid-base64!!!.somesig` },
			});

			const session = await res.json();
			expect(session).toBeNull();
		});

		test("rejects token with invalid JSON payload", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const invalidJson = btoa("not-valid-json{");

			const res = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${invalidJson}.somesig` },
			});

			const session = await res.json();
			expect(session).toBeNull();
		});

		test("rejects empty token", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const res = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=` },
			});

			const session = await res.json();
			expect(session).toBeNull();
		});

		test("rejects token with empty payload", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const res = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=.somesignature` },
			});

			const session = await res.json();
			expect(session).toBeNull();
		});

		test("rejects token with empty signature", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const payload = btoa(
				JSON.stringify({ id: "user", expiration: Date.now() + 10000 }),
			);

			const res = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${payload}.` },
			});

			const session = await res.json();
			expect(session).toBeNull();
		});
	});

	describe("sliding window refresh", () => {
		test("refreshes session when remaining time is less than threshold", async () => {
			const duration = 1000; // 1 second
			const refresh = 800; // refresh when < 800ms remaining

			const app = new App({
				auth: { secret: TEST_SECRET, duration, refresh },
			}).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);
			const originalSession = extractPayload(cookie!.value);

			// Wait until we're within the refresh threshold
			await new Promise((r) => setTimeout(r, 300));

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();

			// Should have issued a new cookie with extended expiration
			const newCookie = getSessionCookie(checkRes);
			expect(newCookie).not.toBeNull();
			const newSession = extractPayload(newCookie!.value);
			expect(newSession.expiration).toBeGreaterThan(originalSession.expiration);
		});

		test("uses default refresh threshold (duration / 4)", async () => {
			const duration = Time.hour;

			const app = new App({ auth: { secret: TEST_SECRET, duration } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			// Session is fresh - should NOT refresh
			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(checkRes.headers.get("set-cookie")).toBeNull(); // No refresh
		});
	});

	describe("cookie configuration", () => {
		test("uses __Host-session cookie name by default when secure", async () => {
			const app = new App({ auth: { secret: TEST_SECRET, secure: true } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res, "__Host-session");

			expect(cookie).not.toBeNull();
			expect(cookie!.name).toBe("__Host-session");
		});

		test("uses session cookie name when not secure", async () => {
			const app = new App({ auth: { secret: TEST_SECRET, secure: false } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res, "session");

			expect(cookie).not.toBeNull();
			expect(cookie!.name).toBe("session");
		});

		test("respects custom cookie name", async () => {
			const customCookieName = "my-custom-session";

			const app = new App({
				auth: { secret: TEST_SECRET, cookie: customCookieName },
			}).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res, customCookieName);

			expect(cookie).not.toBeNull();
			expect(cookie!.name).toBe(customCookieName);
		});

		test("reads from custom cookie name", async () => {
			const customCookieName = "custom-auth";

			const app = new App({
				auth: { secret: TEST_SECRET, cookie: customCookieName },
			}).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes, customCookieName);

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `${customCookieName}=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(session.id).toBe("user-123");
		});

		test("does not set Secure flag when secure: false", async () => {
			const app = new App({ auth: { secret: TEST_SECRET, secure: false } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const res = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(res, "session");

			expect(cookie).not.toBeNull();
			expect(cookie!.attrs.secure).toBeUndefined();
		});

		test("respects custom duration", async () => {
			const customDuration = Time.minute * 30;
			let session: Auth.Session | null = null;

			const app = new App({
				auth: { secret: TEST_SECRET, duration: customDuration },
			}).use(
				Route.get("/login", async (c) => {
					session = await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
			);

			const before = Date.now();
			const res = await app.fetch(`${BASE_URL}/login`);
			const after = Date.now();

			expect(session).not.toBeNull();
			expect(session!.expiration).toBeGreaterThanOrEqual(
				before + customDuration,
			);
			expect(session!.expiration).toBeLessThanOrEqual(after + customDuration);

			const cookie = getSessionCookie(res);
			expect(cookie!.attrs["max-age"]).toBe(
				String(Math.floor(customDuration / 1000)),
			);
		});
	});

	describe("key caching", () => {
		test("reuses cached key for same secret across requests", async () => {
			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			// First request creates the key
			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			// Second request should reuse the cached key
			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(session.id).toBe("user-123");
		});
	});

	describe("edge cases", () => {
		test("handles session ID with special characters", async () => {
			const specialId = "user:123/test@example.com";

			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: specialId });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(session.id).toBe(specialId);
		});

		test("handles very long session ID", async () => {
			const longId = "x".repeat(1000);

			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: longId });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(session.id).toBe(longId);
		});

		test("handles unicode in session ID", async () => {
			const unicodeId = "用户123🚀";

			const app = new App({ auth: { secret: TEST_SECRET } }).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: unicodeId });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).not.toBeNull();
			expect(session.id).toBe(unicodeId);
		});

		test("handles session exactly at expiration boundary", async () => {
			const duration = 100;

			const app = new App({
				auth: { secret: TEST_SECRET, duration, refresh: 0 },
			}).use(
				Route.get("/login", async (c) => {
					await c.auth.login({ id: "user-123" });
					c.text("ok");
				}),
				Route.get("/check", async (c) => {
					const session = await c.auth.session();
					c.json(session);
				}),
			);

			const loginRes = await app.fetch(`${BASE_URL}/login`);
			const cookie = getSessionCookie(loginRes);

			// Wait exactly until expiration
			await new Promise((r) => setTimeout(r, duration + 5));

			const checkRes = await app.fetch(`${BASE_URL}/check`, {
				headers: { cookie: `__Host-session=${cookie!.value}` },
			});

			const session = await checkRes.json();
			expect(session).toBeNull();
		});

		test("throws error when auth not configured", async () => {
			const app = new App().use(
				Route.get("/check", async (c) => {
					try {
						await c.auth.session();
					} catch (e) {
						c.text("error: " + (e as Error).message);
					}
				}),
			);

			const res = await app.fetch(`${BASE_URL}/check`);
			const text = await res.text();

			expect(text).toContain("error");
		});
	});
});
