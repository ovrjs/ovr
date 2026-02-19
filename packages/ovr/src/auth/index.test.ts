import { App } from "../app/index.js";
import { Route } from "../route/index.js";
import { Codec } from "../util/index.js";
import { describe, expect, test } from "vitest";

describe("auth sessions", () => {
	test("invalid session cookie logs out instead of throwing", async () => {
		const app = new App({
			auth: { secret: "secret" },
			trailingSlash: "ignore",
		});

		app.use(
			Route.get("/", async (c) => {
				c.json(await c.auth.session());
			}),
		);

		const res = await app.fetch(
			new Request("https://example.com/", {
				headers: { cookie: "__Host-auth-session=bad" },
			}),
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toBeNull();
		expect(res.headers.get("set-cookie")).toContain("__Host-auth-session=");
		expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
	});

	test("invalid session JSON logs out instead of throwing", async () => {
		const app = new App({
			auth: { secret: "secret" },
			trailingSlash: "ignore",
		});

		app.use(
			Route.get("/token", async (c) => {
				const payload = Codec.Base64Url.encode(
					Codec.encode(JSON.stringify({ id: "123" })),
				);
				c.text(await c.auth.sign(payload));
			}),
			Route.get("/", async (c) => {
				c.json(await c.auth.session());
			}),
		);

		const token = await (await app.fetch("https://example.com/token")).text();
		const res = await app.fetch(
			new Request("https://example.com/", {
				headers: { cookie: `__Host-auth-session=${token}` },
			}),
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toBeNull();
		expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
	});
});

describe("passkey script", () => {
	test("serialize signed payload safely", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });

		const register = Route.post("/register", (c) => c.text("ok"));

		app.use(
			register,
			Route.get("/", (c) => {
				const Register = c.auth.passkey.create(register, undefined, "o'connor");
				return Register({});
			}),
		);

		const res = await app.fetch("https://example.com/");
		const html = await res.text();
		const script = html.match(
			/<script type="module">([\s\S]*?)<\/script>/,
		)?.[1];

		expect(script).toBeDefined();
		expect(() => new Function(script!)).not.toThrow();
	});
});

describe("passkey parsing", () => {
	test("invalid credential JSON is rejected", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });

		app.use(
			Route.post("/verify", async (c) => {
				await c.auth.passkey.verify();
				c.text("ok");
			}),
		);

		const body = new FormData();
		body.set("credential", "{");
		body.set("signed", "bad");

		await expect(
			app.fetch(
				new Request("https://example.com/verify", {
					method: "POST",
					body,
					headers: { origin: "https://example.com" },
				}),
			),
		).rejects.toThrow("Expected JSON");
	});

	test("invalid signed JSON/token is rejected", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });

		app.use(
			Route.post("/verify", async (c) => {
				await c.auth.passkey.verify();
				c.text("ok");
			}),
		);

		const body = new FormData();
		body.set(
			"credential",
			JSON.stringify({
				type: "public-key",
				id: "a",
				rawId: "a",
				response: {
					clientDataJSON: Codec.Base64Url.encode(
						Codec.encode(
							JSON.stringify({
								type: "webauthn.create",
								challenge: Codec.Base64Url.encode(Codec.encode("x")),
								origin: "https://example.com",
							}),
						),
					),
					attestationObject: "a",
				},
			}),
		);
		body.set("signed", "bad");

		await expect(
			app.fetch(
				new Request("https://example.com/verify", {
					method: "POST",
					body,
					headers: { origin: "https://example.com" },
				}),
			),
		).rejects.toThrow("Invalid token");
	});

	test("origin mismatch is rejected", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const challenge = Codec.Base64Url.encode(Codec.encode("x"));

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({ challenge, user: "user" } satisfies {
							challenge: string;
							user: string;
						}),
					),
				);
			}),
			Route.post("/verify", async (c) => {
				await c.auth.passkey.verify();
				c.text("ok");
			}),
		);

		const signed = await (await app.fetch("https://example.com/token")).text();

		const body = new FormData();
		body.set(
			"credential",
			JSON.stringify({
				type: "public-key",
				id: "a",
				rawId: "a",
				response: {
					clientDataJSON: Codec.Base64Url.encode(
						Codec.encode(
							JSON.stringify({
								type: "webauthn.create",
								challenge,
								origin: "https://evil.example",
							}),
						),
					),
					attestationObject: "a",
				},
			}),
		);
		body.set("signed", signed);

		await expect(
			app.fetch(
				new Request("https://example.com/verify", {
					method: "POST",
					body,
					headers: { origin: "https://example.com" },
				}),
			),
		).rejects.toThrow("Origin mismatch");
	});
});
