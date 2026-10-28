import { App } from "../app/index.js";
import { jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Field } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import type { Auth } from "./index.js";
import { Passkey } from "./passkey.js";
import { describe, expect, test, vi } from "vitest";

const origin = "https://example.com";
const user = "user-1";
const id = Codec.Base64Url.encode(Uint8Array.of(1, 2, 3, 4));
const bytes = (...parts: Uint8Array[]) => {
	const result = new Uint8Array(
		parts.reduce((sum, part) => sum + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
};
const text = (value: string) =>
	bytes(Uint8Array.of(0x60 + value.length), Codec.encode(value));
const binary = (value: Uint8Array) =>
	bytes(
		value.length < 24
			? Uint8Array.of(0x40 + value.length)
			: value.length < 256
				? Uint8Array.of(0x58, value.length)
				: Uint8Array.of(0x59, value.length >> 8, value.length & 255),
		value,
	);
const count = (value: number) =>
	Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
const hash = async (value: Uint8Array<ArrayBuffer>) =>
	new Uint8Array(await crypto.subtle.digest("SHA-256", value));
const pair = () =>
	crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
const der = (raw: Uint8Array) => {
	const integer = (value: Uint8Array) => {
		while (value.length > 1 && value[0] === 0) value = value.subarray(1);
		if (value[0]! & 128) value = bytes(Uint8Array.of(0), value);
		return bytes(Uint8Array.of(2, value.length), value);
	};
	const value = bytes(integer(raw.subarray(0, 32)), integer(raw.subarray(32)));
	return bytes(Uint8Array.of(0x30, value.length), value);
};

async function registration(
	challenge: string,
	keys: CryptoKeyPair,
	{
		flags = 0x45,
		counter = 0,
		alg = -7,
		rp = "example.com",
		invalid = false,
		client = {},
	}: {
		flags?: number;
		counter?: number;
		alg?: number;
		rp?: string;
		invalid?: boolean;
		client?: object;
	} = {},
) {
	const key = await crypto.subtle.exportKey("jwk", keys.publicKey);
	const cose = bytes(
		Uint8Array.of(0xa5, 1, 2, 3, alg === -7 ? 0x26 : 0x25, 0x20, 1, 0x21),
		binary(invalid ? new Uint8Array(32) : Codec.Base64Url.decode(key.x!)),
		Uint8Array.of(0x22),
		binary(invalid ? new Uint8Array(32) : Codec.Base64Url.decode(key.y!)),
	);
	const data = bytes(
		await hash(Codec.encode(rp)),
		Uint8Array.of(flags),
		count(counter),
		new Uint8Array(16),
		Uint8Array.of(0, 4),
		Codec.Base64Url.decode(id),
		cose,
	);
	const attestation = bytes(
		Uint8Array.of(0xa3),
		text("fmt"),
		text("none"),
		text("attStmt"),
		Uint8Array.of(0xa0),
		text("authData"),
		binary(data),
	);
	return {
		id,
		rawId: id,
		type: "public-key",
		response: {
			clientDataJSON: Codec.Base64Url.encode(
				Codec.encode(
					JSON.stringify({
						type: "webauthn.create",
						origin,
						challenge,
						...client,
					}),
				),
			),
			attestationObject: Codec.Base64Url.encode(attestation),
		},
	};
}

async function assertion(
	challenge: string,
	keys: CryptoKeyPair,
	{
		flags = 5,
		counter = 0,
		handle = user,
		client = {},
	}: {
		flags?: number;
		counter?: number;
		handle?: string | null;
		client?: object;
	} = {},
) {
	const json = Codec.Base64Url.encode(
		Codec.encode(
			JSON.stringify({ type: "webauthn.get", origin, challenge, ...client }),
		),
	);
	const data = bytes(
		await hash(Codec.encode("example.com")),
		Uint8Array.of(flags),
		count(counter),
	);
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		keys.privateKey,
		bytes(data, await hash(Codec.Base64Url.decode(json))),
	);
	return {
		id,
		rawId: id,
		type: "public-key",
		response: {
			clientDataJSON: json,
			authenticatorData: Codec.Base64Url.encode(data),
			signature: Codec.Base64Url.encode(der(new Uint8Array(signature))),
			userHandle:
				handle === null ? null : Codec.Base64Url.encode(Codec.encode(handle)),
		},
	};
}

function setup(extra: Partial<Auth.Options> = {}) {
	const challenges = new Map<string, Auth.Challenge>();
	const sessions = new Map<string, Auth.Session>();
	const records = new Map<string, Auth.Credential>();
	const credentials: Auth.Credentials = {
		find: (id) => records.get(id),
		update: (credential, previous) => {
			if (records.get(credential.id) !== previous) return false;
			records.set(credential.id, credential);
			return true;
		},
	};
	const options: Auth.Options = {
		secret: "test-secret-with-at-least-32-bytes",
		origin,
		challenges: {
			set: (id, value) => {
				challenges.set(id, value);
			},
			take: (id) => {
				const value = challenges.get(id);
				challenges.delete(id);
				return value;
			},
		},
		sessions: {
			set: (id, value) => {
				sessions.set(id, value);
			},
			get: (id) => sessions.get(id),
			delete: (id) => {
				sessions.delete(id);
			},
		},
		...extra,
	};
	const app = new App({ auth: options });
	const register = Route.post(
		"/register",
		{ email: Field.email() },
		async (c) => {
			const input = await c.data();
			if (input.issues) throw input;
			const credential = await c.auth.passkey.register.verify();
			if (records.has(credential.id)) throw new Error("Duplicate credential");
			records.set(credential.id, credential);
			c.json(credential);
		},
	);
	const login = Route.post("/login", async (c) =>
		c.json(await c.auth.passkey.login.verify(credentials)),
	);
	app.use(
		register,
		login,
		Route.get("/register-page", (c) =>
			jsx(c.auth.passkey.register.form(register, { user }), {}),
		),
		Route.get("/login-page", (c) => jsx(c.auth.passkey.login.form(login), {})),
		Route.get("/session", async (c) => c.json(await c.auth.session())),
		Route.post("/session", async (c) => c.json(await c.auth.login(user))),
		Route.post("/logout", async (c) => c.json(await c.auth.logout())),
		Route.post("/revoke/:token", async (c) => {
			await c.auth.revoke(c.params.token);
			c.text("revoked");
		}),
	);
	const post = (path: string, data: FormData, cookie = "") =>
		app.fetch(origin + path, {
			method: "POST",
			headers: { origin, cookie },
			body: data,
		});
	const start = async (method: "register" | "login", cookie = "") => {
		const page = await app.fetch(`${origin}/${method}-page`, {
			headers: { cookie },
		});
		const html = await page.text();
		const match = html.match(/\}\)\(([^]*?)\)<\/script>/);
		if (!match) throw new Error("Missing passkey script");
		const args: string[] = JSON.parse(`[${match[1]}]`);
		cookie ||= page.headers
			.getSetCookie()
			.map((v) => v.split(";")[0])
			.join("; ");
		const data = new FormData();
		data.set("bootstrap", args[1]!);
		const response = await post(Passkey.options.pathname(), data, cookie);
		const json: {
			challenge: string;
			options: PublicKeyCredentialCreationOptionsJSON;
		} = await response.json();
		return { ...json, cookie, html, bootstrap: args[1]!, page, response };
	};
	const submit = (
		state: { challenge: string; cookie: string },
		credential: unknown,
		path = "/register",
		cookie = state.cookie,
	) => {
		const data = new FormData();
		data.set("email", "user@example.com");
		data.set("credential", JSON.stringify(credential));
		data.set("challenge", state.challenge);
		// Schema-free login expects only the reserved passkey fields.
		if (path !== "/register") data.delete("email");
		return post(path, data, cookie);
	};
	return {
		app,
		challenges,
		sessions,
		records,
		credentials,
		options,
		post,
		start,
		submit,
	};
}

async function enrolled(
	extra: Partial<Auth.Options> = {},
	flags = 0x45,
	counter = 0,
) {
	const state = setup(extra);
	const keys = await pair();
	const start = await state.start("register");
	const response = await state.submit(
		start,
		await registration(start.options.challenge, keys, { flags, counter }),
	);
	expect(response.status).toBe(200);
	return { ...state, keys, cookie: start.cookie };
}

describe("passkey ceremonies", () => {
	test("registers an actual P-256 key and verifies its signed login", async () => {
		const state = await enrolled();
		const login = await state.start("login", state.cookie);
		const response = await state.submit(
			login,
			await assertion(login.options.challenge, state.keys, { counter: 1 }),
			"/login",
		);
		expect(await response.json()).toMatchObject({
			id,
			user,
			counter: 1,
			eligible: false,
		});
		expect(state.records.get(id)?.counter).toBe(1);
		expect(state.challenges.size).toBe(0);
	});

	test("requires discoverable credentials and fetches fresh options at submit time", async () => {
		const state = setup();
		const start = await state.start("register");
		expect(start.options.authenticatorSelection).toMatchObject({
			residentKey: "required",
			requireResidentKey: true,
			userVerification: "required",
		});
		expect(start.response.headers.get("cache-control")).toBe("no-store");
		expect(start.page.headers.get("cache-control")).toBe("no-store");
		expect(start.page.headers.getSetCookie()[0]).toContain("HttpOnly");
		const again = new FormData();
		again.set("bootstrap", start.bootstrap);
		const next = await state.post(
			Passkey.options.pathname(),
			again,
			start.cookie,
		);
		expect((await next.json()).options.challenge).not.toBe(
			start.options.challenge,
		);
	});

	test("rejects a replay, including simultaneous submissions", async () => {
		const state = await enrolled();
		const login = await state.start("login", state.cookie);
		const credential = await assertion(login.options.challenge, state.keys);
		const results = await Promise.allSettled([
			state.submit(login, credential, "/login"),
			state.submit(login, credential, "/login"),
		]);
		expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
		await expect(state.submit(login, credential, "/login")).rejects.toThrow(
			"consumed",
		);
	});

	test("rejects browser changes and missing bindings", async () => {
		const state = setup();
		for (const cookie of ["", "__Host-auth-browser=another-browser"]) {
			const start = await state.start("register");
			await expect(
				state.submit(
					start,
					await registration(start.options.challenge, await pair()),
					"/register",
					cookie,
				),
			).rejects.toThrow("browser");
		}
	});

	test("rejects bootstrap tampering, expiry, and use by another browser", async () => {
		const state = setup();
		const start = await state.start("register");
		for (const [bootstrap, cookie] of [
			[start.bootstrap + "x", start.cookie],
			[start.bootstrap, "__Host-auth-browser=other"],
		]) {
			const data = new FormData();
			data.set("bootstrap", bootstrap!);
			await expect(
				state.post(Passkey.options.pathname(), data, cookie),
			).rejects.toThrow();
		}
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + Time.hour + 1);
		try {
			const data = new FormData();
			data.set("bootstrap", start.bootstrap);
			await expect(
				state.post(Passkey.options.pathname(), data, start.cookie),
			).rejects.toThrow("expired");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("consumes expired challenges and rejects the wrong route or ceremony", async () => {
		const state = setup();
		const start = await state.start("register");
		state.challenges.set(start.challenge, {
			...state.challenges.get(start.challenge)!,
			expiration: Date.now() - 1,
		});
		await expect(state.submit(start, {})).rejects.toThrow("expired");
		const wrong = await state.start("register", start.cookie);
		await expect(state.submit(wrong, {}, "/login")).rejects.toThrow("binding");
		expect(state.challenges.size).toBe(0);
	});

	test.each([
		{ origin: "https://evil.example" },
		{ type: "webauthn.get" },
		{ crossOrigin: true },
		{ challenge: "wrong" },
	])("rejects invalid registration client data: %j", async (client) => {
		const state = setup();
		const start = await state.start("register");
		await expect(
			state.submit(
				start,
				await registration(start.options.challenge, await pair(), { client }),
			),
		).rejects.toThrow();
		expect(state.records.size).toBe(0);
	});

	test.each([0x41, 0x44, 0x55])(
		"rejects missing user flags or invalid backup flags: %i",
		async (flags) => {
			const state = setup();
			const start = await state.start("register");
			await expect(
				state.submit(
					start,
					await registration(start.options.challenge, await pair(), { flags }),
				),
			).rejects.toThrow();
		},
	);

	test("rejects a registration algorithm other than ES256 and mismatched credential IDs", async () => {
		const state = setup();
		let start = await state.start("register");
		await expect(
			state.submit(
				start,
				await registration(start.options.challenge, await pair(), { alg: -6 }),
			),
		).rejects.toThrow("algorithm");
		start = await state.start("register", start.cookie);
		const credential = await registration(
			start.options.challenge,
			await pair(),
		);
		credential.rawId = "BAUG";
		await expect(state.submit(start, credential)).rejects.toThrow(
			"credential ID",
		);
	});

	test.each([null, "another-user"])(
		"rejects a missing or mismatched discoverable user handle: %s",
		async (handle) => {
			const state = await enrolled();
			const login = await state.start("login", state.cookie);
			await expect(
				state.submit(
					login,
					await assertion(login.options.challenge, state.keys, { handle }),
					"/login",
				),
			).rejects.toThrow("user handle");
		},
	);

	test("rejects signatures from another key without updating storage", async () => {
		const state = await enrolled();
		const login = await state.start("login", state.cookie);
		const update = vi.spyOn(state.credentials, "update");
		await expect(
			state.submit(
				login,
				await assertion(login.options.challenge, await pair()),
				"/login",
			),
		).rejects.toThrow("signature");
		expect(update).not.toHaveBeenCalled();
	});

	test("rejects non-increasing counters while allowing authenticators that always report zero", async () => {
		const state = await enrolled({}, 0x45, 2);
		for (const counter of [0, 1, 2]) {
			const login = await state.start("login", state.cookie);
			await expect(
				state.submit(
					login,
					await assertion(login.options.challenge, state.keys, { counter }),
					"/login",
				),
			).rejects.toThrow("counter");
		}
	});

	test("persists backup changes, rejects eligibility changes and failed atomic updates", async () => {
		const state = await enrolled({}, 0x4d);
		const login = await state.start("login", state.cookie);
		await state.submit(
			login,
			await assertion(login.options.challenge, state.keys, { flags: 0x1d }),
			"/login",
		);
		expect(state.records.get(id)?.backedUp).toBe(true);
		const changed = await state.start("login", state.cookie);
		await expect(
			state.submit(
				changed,
				await assertion(changed.options.challenge, state.keys),
				"/login",
			),
		).rejects.toThrow("eligibility");
		vi.spyOn(state.credentials, "update").mockResolvedValue(false);
		const stale = await state.start("login", state.cookie);
		await expect(
			state.submit(
				stale,
				await assertion(stale.options.challenge, state.keys, { flags: 0x1d }),
				"/login",
			),
		).rejects.toThrow("changed");
	});

	test("does not trust a different request host even with a valid browser cookie", async () => {
		const state = setup();
		await expect(
			state.app.fetch("https://evil.example/register-page"),
		).rejects.toThrow("origin");
	});
});

describe("revocable sessions", () => {
	test("issues a secure cookie, reads it, and invalidates copied cookies on logout", async () => {
		const state = setup();
		const response = await state.post("/session", new FormData());
		const session: Auth.Session = await response.json();
		const cookie = response.headers.getSetCookie().at(-1)!.split(";")[0]!;
		expect(response.headers.getSetCookie().at(-1)).toContain(
			"Secure; HttpOnly; SameSite=Lax",
		);
		expect(
			await (
				await state.app.fetch(origin + "/session", { headers: { cookie } })
			).json(),
		).toEqual(session);
		await state.post("/logout", new FormData(), cookie);
		expect(
			await (
				await state.app.fetch(origin + "/session", { headers: { cookie } })
			).json(),
		).toBeNull();
		expect(state.sessions.size).toBe(0);
	});

	test("rotates sessions and supports explicit revocation", async () => {
		const state = setup();
		const first = await state.post("/session", new FormData());
		const cookie = first.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const second = await state.post("/session", new FormData(), cookie);
		const session: Auth.Session = await second.json();
		expect(state.sessions.size).toBe(1);
		expect(
			await (
				await state.app.fetch(origin + "/session", { headers: { cookie } })
			).json(),
		).toBeNull();
		await state.post(`/revoke/${session.token}`, new FormData());
		expect(state.sessions.size).toBe(0);
	});

	test("expires sessions without sliding refresh and propagates storage errors", async () => {
		const state = setup({ duration: Time.second });
		const login = await state.post("/session", new FormData());
		const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const session: Auth.Session = await login.json();
		vi.spyOn(Date, "now").mockReturnValue(session.expiration);
		try {
			expect(
				await (
					await state.app.fetch(origin + "/session", { headers: { cookie } })
				).json(),
			).toBeNull();
		} finally {
			vi.restoreAllMocks();
		}
		vi.spyOn(state.options.sessions, "get").mockRejectedValue(
			new Error("storage unavailable"),
		);
		await expect(
			state.app.fetch(origin + "/session", { headers: { cookie } }),
		).rejects.toThrow("storage unavailable");
	});

	test("invalid signatures clear the cookie and configuration rejects insecure origins or weak secrets", async () => {
		const state = setup();
		const response = await state.app.fetch(origin + "/session", {
			headers: { cookie: "__Host-auth-session=bad" },
		});
		expect(await response.json()).toBeNull();
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		await expect(
			setup({ secret: "weak" }).app.fetch(origin + "/session"),
		).rejects.toThrow("32 bytes");
		await expect(
			setup({ origin: "http://example.com" }).app.fetch(origin + "/session"),
		).rejects.toThrow("HTTPS");
	});
});

describe("form contracts", () => {
	test("retains typed route parameters and safely serializes script arguments", async () => {
		const state = setup();
		const route = Route.post(
			"/accounts/:account/passkeys",
			{ email: Field.email() },
			(c) => c.text(c.params.account),
		);
		state.app.use(
			route,
			Route.get("/typed", (c) => {
				const Register = c.auth.passkey.register.form(route, {
					user: "user</script><script>alert(1)</script>",
				});
				if (false) {
					// @ts-expect-error Route parameters remain required by the returned component.
					Register({});
					// @ts-expect-error Route parameter names remain exact.
					Register({ params: { wrong: "account" } });
				}
				return jsx(Register, {
					params: { account: "42" },
					search: { from: "settings" },
				});
			}),
		);
		const page = await state.app.fetch(origin + "/typed");
		const html = await page.text();
		expect(html).toContain("/accounts/42/passkeys?");
		expect(html).not.toContain("</script><script>alert");
		expect(html.match(/<script/g)).toHaveLength(1);
		expect(html).toContain("\\u003c/script\\u003e");
	});

	test("rejects reserved schema fields rather than silently replacing them", async () => {
		const state = setup();
		const route = Route.post(
			"/conflict",
			{ credential: Field.email(), challenge: Field.text() },
			(c) => c.text("unused"),
		);
		state.app.use(
			Route.get("/conflict", (c) => {
				c.auth.passkey.register.form(route);
			}),
		);
		await expect(state.app.fetch(origin + "/conflict")).rejects.toThrow(
			"reserve",
		);
	});

	test("binds stored challenges to their exact pathname", async () => {
		const state = setup();
		const start = await state.start("register");
		state.challenges.set(start.challenge, {
			...state.challenges.get(start.challenge)!,
			action: "/register/other",
		});
		await expect(state.submit(start, {})).rejects.toThrow("binding");
	});
});

describe("cryptographic input validation", () => {
	test("rejects a different RP hash even with the correct client origin", async () => {
		const state = setup();
		const start = await state.start("register");
		await expect(
			state.submit(
				start,
				await registration(start.options.challenge, await pair(), {
					rp: "evil.example",
				}),
			),
		).rejects.toThrow("RP ID");
	});

	test("rejects P-256 coordinates that do not represent a valid curve point", async () => {
		const state = setup();
		const start = await state.start("register");
		await expect(
			state.submit(
				start,
				await registration(start.options.challenge, await pair(), {
					invalid: true,
				}),
			),
		).rejects.toThrow("public key");
		expect(state.records.size).toBe(0);
	});

	test("rejects malformed credential JSON and invalid base64url without persisting a key", async () => {
		const state = setup();
		const start = await state.start("register");
		const credential = await registration(
			start.options.challenge,
			await pair(),
		);
		credential.rawId = "A";
		await expect(state.submit(start, credential)).rejects.toThrow("base64url");
		expect(state.records.size).toBe(0);
	});

	test("does not report a successful logout when revocation storage fails", async () => {
		const state = setup();
		const login = await state.post("/session", new FormData());
		const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
		vi.spyOn(state.options.sessions, "delete").mockRejectedValue(
			new Error("revocation unavailable"),
		);
		await expect(state.post("/logout", new FormData(), cookie)).rejects.toThrow(
			"revocation unavailable",
		);
	});
});
