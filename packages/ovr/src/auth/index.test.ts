import { App } from "../app/index.js";
import { Route } from "../route/index.js";
import { Schema } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { COSE } from "./cbor.js";
import { Passkey } from "./passkey.js";
import { describe, expect, test } from "vitest";

/**
 * Concatenate byte arrays.
 *
 * @param parts Byte chunks
 * @returns Combined bytes
 */
const bytes = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;

	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
};

/**
 * Encode a short CBOR text value.
 *
 * @param value Text value
 * @returns CBOR bytes
 */
const cborText = (value: string) =>
	bytes(Uint8Array.of(0x60 + value.length), Codec.encode(value));

/**
 * Encode a CBOR byte string.
 *
 * @param value Raw bytes
 * @returns CBOR bytes
 */
const cborBytes = (value: Uint8Array) => {
	if (value.length < 24) {
		return bytes(Uint8Array.of(0x40 + value.length), value);
	}

	if (value.length < 256) {
		return bytes(Uint8Array.of(0x58, value.length), value);
	}

	return bytes(
		Uint8Array.of(0x59, value.length >> 8, value.length & 0xff),
		value,
	);
};

/**
 * Encode a minimal `fmt:none` attestation object.
 *
 * @param authData Authenticator data bytes
 * @returns CBOR bytes
 */
const cborAttestation = (authData: Uint8Array) =>
	bytes(
		Uint8Array.of(0xa2),
		cborText("fmt"),
		cborText("none"),
		cborText("authData"),
		cborBytes(authData),
	);

/**
 * Encode an EC2/P-256 COSE key map.
 *
 * @param x X coordinate
 * @param y Y coordinate
 * @returns CBOR bytes
 */
const coseKey = (x: Uint8Array, y: Uint8Array) =>
	bytes(
		Uint8Array.from([0xa4, 0x01, 0x02, 0x20, 0x01, 0x21, 0x58, 0x20]),
		x,
		Uint8Array.from([0x22, 0x58, 0x20]),
		y,
	);

/**
 * Extract the cookie pair from a `Set-Cookie` header.
 *
 * @param res HTTP response
 * @returns `name=value` cookie pair
 */
const cookie = (res: Response) => res.headers.get("set-cookie")?.split(";")[0]!;

describe("auth tokens", () => {
	test("sign and verify roundtrip payload", async () => {
		const app = new App({
			auth: { secret: "secret" },
			trailingSlash: "ignore",
		});

		app.use(
			Route.get("/", async (c) => {
				const token = await c.auth.sign("payload");
				c.text(await c.auth.verify(token));
			}),
		);

		const res = await app.fetch("https://example.com/");

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("payload");
	});

	test("verify rejects tampered payload", async () => {
		const app = new App({
			auth: { secret: "secret" },
			trailingSlash: "ignore",
		});

		app.use(
			Route.get("/", async (c) => {
				const token = await c.auth.sign("payload");
				const dot = token.lastIndexOf(".");

				await c.auth.verify(`tampered${token.slice(dot)}`);
			}),
		);

		await expect(app.fetch("https://example.com/")).rejects.toThrow(
			"Invalid token",
		);
	});
});

describe("auth cookies", () => {
	test("login sets secure host session cookie", async () => {
		const app = new App({
			auth: { secret: "secret" },
			trailingSlash: "ignore",
		});

		app.use(
			Route.get("/login", async (c) => {
				c.json(await c.auth.login("user-1"));
			}),
		);

		const res = await app.fetch("https://example.com/login");

		expect(res.status).toBe(200);
		expect(res.headers.get("set-cookie")).toContain("__Host-auth-session=");
		expect(cookie(res).startsWith("__Host-auth-session=")).toBe(true);
		expect(res.headers.get("set-cookie")).toContain("HttpOnly");
		expect(res.headers.get("set-cookie")).toContain("Secure");
		expect(res.headers.get("set-cookie")).toContain("SameSite=Lax");
		expect(res.headers.get("set-cookie")).toContain("Max-Age=604800");
	});

	test("session returns valid cookie payload without refresh", async () => {
		const app = new App({
			auth: { secret: "secret", duration: 10_000, refresh: 1_000 },
			trailingSlash: "ignore",
		});
		const expiration = Date.now() + 5_000;

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						Codec.Base64Url.encode(
							Codec.encode(
								JSON.stringify({
									id: "user-1",
									expiration,
								}),
							),
						),
					),
				);
			}),
			Route.get("/session", async (c) => {
				c.json(await c.auth.session());
			}),
		);

		const token = await (await app.fetch("https://example.com/token")).text();
		const res = await app.fetch(
			new Request("https://example.com/session", {
				headers: { cookie: `__Host-auth-session=${token}` },
			}),
		);
		const data = await res.json();

		expect(data).toEqual({ id: "user-1", expiration });
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	test("session refreshes when expiration is within refresh threshold", async () => {
		const app = new App({
			auth: { secret: "secret", duration: 10_000, refresh: 9_000 },
			trailingSlash: "ignore",
		});
		const expiration = Date.now() + 500;

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						Codec.Base64Url.encode(
							Codec.encode(
								JSON.stringify({
									id: "user-1",
									expiration,
								}),
							),
						),
					),
				);
			}),
			Route.get("/session", async (c) => {
				c.json(await c.auth.session());
			}),
		);

		const token = await (await app.fetch("https://example.com/token")).text();
		const res = await app.fetch(
			new Request("https://example.com/session", {
				headers: { cookie: `__Host-auth-session=${token}` },
			}),
		);
		const data = await res.json();

		expect(data.id).toBe("user-1");
		expect(data.expiration).toBeGreaterThan(expiration);
		expect(res.headers.get("set-cookie")).toContain("Max-Age=10");
	});
});

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

	test("session rethrows unexpected runtime errors", async () => {
		const app = new App({
			auth: { secret: "secret" },
			trailingSlash: "ignore",
		});
		const error = new Error("Unexpected runtime error");

		app.use(
			Route.get("/", async (c) => {
				Object.assign(c.auth, {
					verify: async (_token: string) => {
						throw error;
					},
				});

				await c.auth.session();
			}),
		);

		await expect(
			app.fetch(
				new Request("https://example.com/", {
					headers: { cookie: "__Host-auth-session=bad" },
				}),
			),
		).rejects.toThrow("Unexpected runtime error");
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

	test("escape script terminators in serialized args", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const register = Route.post("/register", (c) => c.text("ok"));
		const user = "</script><script>window.__pwned=1</script>";

		app.use(
			register,
			Route.get("/", (c) => {
				const Register = c.auth.passkey.create(register, undefined, user);
				return Register({});
			}),
		);

		const res = await app.fetch("https://example.com/");
		const html = await res.text();
		const script = html.match(
			/<script type="module">([\s\S]*?)<\/script>/,
		)?.[1];

		expect(html).not.toContain(user);
		expect(script).toContain(
			"\\u003c/script\\u003e\\u003cscript\\u003ewindow.__pwned=1\\u003c/script\\u003e",
		);
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

	test("assert rejects invalid signed token before lookup", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		let calls = 0;

		app.use(
			Route.post("/assert", async (c) => {
				await c.auth.passkey.assert(() => {
					calls++;

					return { id: "a", user: "user", publicKey: "a" };
				});
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
								type: "webauthn.get",
								challenge: Codec.Base64Url.encode(Codec.encode("x")),
								origin: "https://example.com",
							}),
						),
					),
					authenticatorData: "a",
					signature: "a",
				},
			}),
		);
		body.set("signed", "bad");

		await expect(
			app.fetch(
				new Request("https://example.com/assert", {
					method: "POST",
					body,
					headers: { origin: "https://example.com" },
				}),
			),
		).rejects.toThrow("Invalid token");
		expect(calls).toBe(0);
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
		).rejects.toThrow("Invalid origin");
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
		).rejects.toThrow("Invalid action");
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
		).rejects.toThrow("Invalid challenge (expired)");
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
		).rejects.toThrow("Invalid challenge (expired)");
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

	test("options route returns registration options for create bootstrap", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });

		app.use(
			Route.get("/bootstrap", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							method: "create",
							action: "/verify",
							user: "user-1",
							exclude: ["cred-1"],
						} satisfies Schema.Infer<typeof Passkey.bCreate>),
					),
				);
			}),
			Route.get("/decode", async (c) => {
				const signed = c.url.searchParams.get("signed");
				if (!signed) throw new Error("Missing signed token");

				c.text(await c.auth.verify(signed));
			}),
		);

		const bootstrap = await (
			await app.fetch("https://example.com/bootstrap")
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
		const data = await res.json();
		const signed = JSON.parse(
			await (
				await app.fetch(
					`https://example.com/decode?signed=${encodeURIComponent(data.signed)}`,
				)
			).text(),
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(data.options.rp.id).toBe("example.com");
		expect(data.options.user.name).toBe("user-1");
		expect(data.options.user.displayName).toBe("user-1");
		expect(data.options.attestation).toBe("none");
		expect(data.options.timeout).toBe(Time.minute);
		expect(data.options.excludeCredentials).toEqual([
			{ type: "public-key", id: "cred-1" },
		]);
		expect(signed.action).toBe("/verify");
		expect(signed.user).toBe("user-1");
		expect(signed.exp - signed.iat).toBe(Time.minute);
		expect(typeof signed.challenge).toBe("string");
	});

	test("verify returns credential for valid attestation payload", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const challenge = Codec.Base64Url.encode(Codec.encode("challenge-1"));
		const credId = crypto.getRandomValues(new Uint8Array(16));
		const x = crypto.getRandomValues(new Uint8Array(32));
		const y = crypto.getRandomValues(new Uint8Array(32));
		const key = new Map<number, number | Uint8Array>([
			[1, 2],
			[-1, 1],
			[-2, x],
			[-3, y],
		]);
		const rpIdHash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", Codec.encode("example.com")),
		);
		const authData = bytes(
			rpIdHash,
			Uint8Array.of(0x45),
			Uint8Array.of(0, 0, 0, 1),
			new Uint8Array(16),
			Uint8Array.of(0x00, credId.length),
			credId,
			coseKey(x, y),
		);

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							user: "user-1",
							iat: Date.now(),
							exp: Date.now() + Time.minute,
							action: "/verify",
						} satisfies Schema.Infer<typeof Passkey.create>),
					),
				);
			}),
			Route.post("/verify", async (c) => {
				c.json(await c.auth.passkey.verify());
			}),
		);

		const signed = await (await app.fetch("https://example.com/token")).text();
		const body = new FormData();
		body.set(
			"credential",
			JSON.stringify({
				type: "public-key",
				id: "id",
				rawId: "id",
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
					attestationObject: Codec.Base64Url.encode(cborAttestation(authData)),
				},
			}),
		);
		body.set("signed", signed);

		const res = await app.fetch(
			new Request("https://example.com/verify", {
				method: "POST",
				body,
				headers: { origin: "https://example.com" },
			}),
		);
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data).toEqual({
			id: Codec.Base64Url.encode(credId),
			user: "user-1",
			publicKey: Codec.Base64Url.encode(COSE.toSPKI(key)),
		});
	});

	test("assert returns stored credential for valid signed assertion", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const keys = (await crypto.subtle.generateKey(
			{
				name: "ECDSA",
				namedCurve: "P-256",
			},
			true,
			["sign", "verify"],
		)) as CryptoKeyPair;
		const id = Codec.Base64Url.encode(crypto.getRandomValues(new Uint8Array(16)));
		const stored = {
			id,
			user: "user-1",
			publicKey: Codec.Base64Url.encode(
				new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey)),
			),
		};
		const challenge = Codec.Base64Url.encode(Codec.encode("challenge-2"));
		const clientData = Codec.encode(
			JSON.stringify({
				type: "webauthn.get",
				challenge,
				origin: "https://example.com",
			}),
		);
		const rpIdHash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", Codec.encode("example.com")),
		);
		const authData = bytes(rpIdHash, Uint8Array.of(0x05), Uint8Array.of(0, 0, 0, 1));
		const clientHash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", clientData),
		);
		const signature = Codec.Base64Url.encode(
			new Uint8Array(
				await crypto.subtle.sign(
					{
						name: "ECDSA",
						hash: "SHA-256",
					},
					keys.privateKey,
					bytes(authData, clientHash),
				),
			),
		);

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							iat: Date.now(),
							exp: Date.now() + Time.minute,
							action: "/assert",
						} satisfies Schema.Infer<typeof Passkey.get>),
					),
				);
			}),
			Route.post("/assert", async (c) => {
				c.json(
					await c.auth.passkey.assert((input) =>
						input === stored.id ? stored : null,
					),
				);
			}),
		);

		const signed = await (await app.fetch("https://example.com/token")).text();
		const body = new FormData();
		body.set(
			"credential",
			JSON.stringify({
				type: "public-key",
				id: stored.id,
				rawId: stored.id,
				response: {
					clientDataJSON: Codec.Base64Url.encode(clientData),
					authenticatorData: Codec.Base64Url.encode(authData),
					signature,
				},
			}),
		);
		body.set("signed", signed);

		const res = await app.fetch(
			new Request("https://example.com/assert", {
				method: "POST",
				body,
				headers: { origin: "https://example.com" },
			}),
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(stored);
	});

	test("assert rejects when lookup does not return a credential", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const challenge = Codec.Base64Url.encode(Codec.encode("x"));

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							iat: Date.now(),
							exp: Date.now() + Time.minute,
							action: "/assert",
						} satisfies Schema.Infer<typeof Passkey.get>),
					),
				);
			}),
			Route.post("/assert", async (c) => {
				await c.auth.passkey.assert(() => null);
				c.text("ok");
			}),
		);

		const signed = await (await app.fetch("https://example.com/token")).text();
		const body = new FormData();
		body.set(
			"credential",
			JSON.stringify({
				type: "public-key",
				id: "credential-id",
				rawId: "credential-id",
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
		).rejects.toThrow("Invalid credential");
	});

	test("assert rejects when credential id does not match lookup result", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });
		const challenge = Codec.Base64Url.encode(Codec.encode("x"));

		app.use(
			Route.get("/token", async (c) => {
				c.text(
					await c.auth.sign(
						JSON.stringify({
							challenge,
							iat: Date.now(),
							exp: Date.now() + Time.minute,
							action: "/assert",
						} satisfies Schema.Infer<typeof Passkey.get>),
					),
				);
			}),
			Route.post("/assert", async (c) => {
				await c.auth.passkey.assert(() => ({
					id: Codec.Base64Url.encode(Codec.encode("other")),
					user: "user-1",
					publicKey: "public-key",
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
				id: Codec.Base64Url.encode(Codec.encode("credential-id")),
				rawId: Codec.Base64Url.encode(Codec.encode("credential-id")),
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
		).rejects.toThrow("Invalid credential ID");
	});
});
