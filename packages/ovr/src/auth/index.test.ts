import { App } from "../app/index.js";
import { Route } from "../route/index.js";
import { Codec } from "../util/index.js";
import { Passkey } from "./passkey.js";
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
		const iat = Date.now();
		const exp = iat + 60_000;

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							user: "user",
							iat,
							exp,
							action: "/verify",
						} satisfies {
							challenge: string;
							user: string;
							iat: number;
							exp: number;
							action: string;
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

	test("action mismatch is rejected", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const challenge = Codec.Base64Url.encode(Codec.encode("x"));
		const iat = Date.now();
		const exp = iat + 60_000;

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							user: "user",
							iat,
							exp,
							action: "/other",
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
								origin: "https://example.com",
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
		).rejects.toThrow("Action mismatch");
	});

	test("expired challenge is rejected for verify", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const challenge = Codec.Base64Url.encode(Codec.encode("x"));
		const iat = Date.now() - 10_000;
		const exp = Date.now() - 1_000;

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							user: "user",
							iat,
							exp,
							action: "/verify",
						} satisfies {
							challenge: string;
							user: string;
							iat: number;
							exp: number;
							action: string;
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
								origin: "https://example.com",
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
		).rejects.toThrow("Challenge expired");
	});

	test("expired challenge is rejected for assert", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const challenge = Codec.Base64Url.encode(Codec.encode("x"));
		const iat = Date.now() - 10_000;
		const exp = Date.now() - 1_000;

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							iat,
							exp,
							action: "/assert",
						} satisfies {
							challenge: string;
							iat: number;
							exp: number;
							action: string;
						}),
					),
				);
			}),
			Route.post("/assert", async (c) => {
				await c.auth.passkey.assert(() => ({
					id: "a",
					user: "user",
					publicKey: "a",
				}));
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
								type: "webauthn.get",
								challenge,
								origin: "https://example.com",
							}),
						),
					),
					authenticatorData: "a",
					signature: "a",
				},
			}),
		);
		body.set("signed", signed);

		await expect(
			app.fetch(
				new Request("https://example.com/assert", {
					method: "POST",
					body,
					headers: { origin: "https://example.com" },
				}),
			),
		).rejects.toThrow("Challenge expired");
	});

	test("options route is auto-registered", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({ method: "get", action: "/assert" } satisfies {
							method: "get";
							action: string;
						}),
					),
				);
			}),
		);

		const bootstrap = await (
			await app.fetch("https://example.com/token")
		).text();
		const body = new FormData();
		body.set("bootstrap", bootstrap);

		const res = await app.fetch(
			new Request(`https://example.com${Passkey.options.url()}`, {
				method: "POST",
				body,
				headers: { origin: "https://example.com" },
			}),
		);

		expect(res.status).toBe(200);

		const data = await res.json();

		expect(typeof data.signed).toBe("string");
		expect(data.options).toBeTruthy();
		expect(typeof data.options.challenge).toBe("string");
	});

	test("invalid options bootstrap token is rejected", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const body = new FormData();
		body.set("bootstrap", "bad");

		await expect(
			app.fetch(
				new Request(`https://example.com${Passkey.options.url()}`, {
					method: "POST",
					body,
					headers: { origin: "https://example.com" },
				}),
			),
		).rejects.toThrow("Invalid token");
	});
});
