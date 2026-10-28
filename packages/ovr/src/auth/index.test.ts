import { App } from "../app/index.js";
import { jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Field } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { Auth } from "./index.js";
import { Passkey } from "./passkey.js";
import { describe, expect, test, vi } from "vitest";

const origin = "https://example.com";
const endpoint = "/_ovr/passkey/options";
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
	// Internal protocol tests compose their own routes; applications use Auth.passkey().
	app.use(
		Route.post(endpoint, { bootstrap: Field.text() }, async (c) => {
			const input = await c.data({ payload: 128 * 1024 });
			if (input.issues) throw input;
			await Passkey.issue(c, input.data.bootstrap);
		}),
		Passkey.client,
	);
	const register = Route.post(
		"/register",
		{ email: Field.email() },
		async (c) => {
			const input = await c.data();
			if (input.issues) throw input;
			const credential = await new Passkey(c, c.auth).register.verify();
			if (records.has(credential.id)) throw new Error("Duplicate credential");
			records.set(credential.id, credential);
			c.json(credential);
		},
	);
	const login = Route.post("/login", async (c) =>
		c.json(await new Passkey(c, c.auth).login.verify(credentials)),
	);
	Passkey.prepare(register);
	Passkey.prepare(login);
	app.use(
		register,
		login,
		Route.get("/register-page", (c) =>
			jsx(
				new Passkey(c, c.auth).register.form(register, { user, endpoint }),
				{},
			),
		),
		Route.get("/login-page", (c) =>
			jsx(new Passkey(c, c.auth).login.form(login, { endpoint }), {}),
		),
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
		const match = html.match(/data-bootstrap="([^"]+)"/);
		if (!match) throw new Error("Missing passkey bootstrap");
		const bootstrap = match[1]!
			.replaceAll("&quot;", '"')
			.replaceAll("&lt;", "<")
			.replaceAll("&amp;", "&");
		cookie ||= page.headers
			.getSetCookie()
			.map((v) => v.split(";")[0])
			.join("; ");
		const data = new FormData();
		data.set("bootstrap", bootstrap);
		const response = await post(endpoint, data, cookie);
		const json: {
			ceremony: string;
			options: PublicKeyCredentialCreationOptionsJSON;
		} = await response.json();
		return { ...json, cookie, html, bootstrap: bootstrap, page, response };
	};
	const submit = (
		state: { ceremony: string; cookie: string },
		credential: unknown,
		path = "/register",
		cookie = state.cookie,
	) => {
		const data = new FormData();
		data.set("email", "user@example.com");
		data.set("credential", JSON.stringify(credential));
		data.set("ceremony", state.ceremony);
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
		const next = await state.post(endpoint, again, start.cookie);
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
			await expect(state.post(endpoint, data, cookie)).rejects.toThrow();
		}
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + Time.hour + 1);
		try {
			const data = new FormData();
			data.set("bootstrap", start.bootstrap);
			await expect(state.post(endpoint, data, start.cookie)).rejects.toThrow(
				"expired",
			);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("consumes expired challenges and rejects the wrong route or ceremony", async () => {
		const state = setup();
		const start = await state.start("register");
		state.challenges.set(start.ceremony, {
			...state.challenges.get(start.ceremony)!,
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
		expect(
			(await state.app.fetch("https://evil.example/register-page")).status,
		).toBe(421);
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
		expect(() => setup({ secret: "weak" })).toThrow("32 bytes");
		expect(() => setup({ origin: "http://example.com" })).toThrow("HTTPS");
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
		Passkey.prepare(route);
		state.app.use(
			route,
			Route.get("/typed", (c) => {
				const Register = new Passkey(c, c.auth).register.form(route, {
					endpoint,
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
		expect(html).toContain("&lt;/script>");
		expect(html).toContain('src="/_ovr/passkey/client.js"');
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
				new Passkey(c, c.auth).register.form(route, { endpoint });
			}),
		);
		expect(() => Passkey.prepare(route)).toThrow("reserve");
	});

	test("binds stored challenges to their exact pathname", async () => {
		const state = setup();
		const start = await state.start("register");
		state.challenges.set(start.ceremony, {
			...state.challenges.get(start.ceremony)!,
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

function managed(
	storage = setup(),
	extra: Partial<
		import("./configure.js").Configuration<{
			email: ReturnType<typeof Field.email>;
		}>
	> = {},
) {
	const create = vi.fn(
		(data: { email: string }, credential: Auth.Credential) => {
			if (storage.records.has(credential.id))
				throw new Error("duplicate credential");
			expect(data).toEqual({ email: "user@example.com" });
			storage.records.set(credential.id, credential);
		},
	);
	const error = vi.fn();
	const service = Auth.passkey({
		...storage.options,
		credentials: storage.credentials,
		allow: () => true,
		page: "/auth",
		redirect: "/account",
		error,
		register: {
			fields: { email: Field.email() },
			name: (data) => data.email,
			create,
		},
		...extra,
	});
	const app = new App({ auth: service });
	app.use(
		Route.get("/auth", (c) => {
			const { Register, Login } = service.forms(c, { nonce: "csp-nonce" });
			if (false) {
				// @ts-expect-error Application field names remain exact.
				Register.Field({ name: "missing" });
				// @ts-expect-error Protocol internals are not part of the public request API.
				c.auth.passkey;
			}
			return [
				jsx(Register, {
					class: "registration",
					children: [
						jsx(Register.Field, { name: "email" }),
						jsx(Register.Error, { class: "error" }),
						jsx("button", { children: "Join" }),
					],
				}),
				jsx(Login, {}),
			];
		}),
		Route.get("/whoami", async (c) => c.json(await c.auth.session())),
	);
	const post = (path: string, data: FormData, cookie = "") =>
		app.fetch(origin + path, {
			method: "POST",
			headers: { origin, cookie },
			body: data,
		});
	const start = async (
		method: "register" | "login",
		cookie = "",
		target = post,
	) => {
		const page = await app.fetch(origin + "/auth", { headers: { cookie } });
		const html = await page.text();
		const script = [...html.matchAll(/<script[^>]+>/g)]
			.map((v) => v[0])
			.find((v) => v.includes(`data-ovr-passkey="${method}"`))!;
		const bootstrap = script
			.match(/data-bootstrap="([^"]+)"/)![1]!
			.replaceAll("&quot;", '"')
			.replaceAll("&lt;", "<")
			.replaceAll("&amp;", "&");
		const endpoint = script.match(/data-endpoint="([^"]+)"/)![1]!;
		cookie ||= page.headers
			.getSetCookie()
			.map((v) => v.split(";")[0])
			.join("; ");
		const data = new FormData();
		data.set("bootstrap", bootstrap);
		if (method === "register") data.set("email", "user@example.com");
		const response = await target(endpoint, data, cookie);
		const json: {
			ceremony: string;
			options: PublicKeyCredentialCreationOptionsJSON;
		} = await response.json();
		return { ...json, cookie, html, bootstrap, endpoint, page, response };
	};
	const submit = (
		start: { ceremony: string; cookie: string },
		credential: unknown,
		path = "/auth/register",
	) => {
		const data = new FormData();
		data.set("credential", JSON.stringify(credential));
		data.set("ceremony", start.ceremony);
		if (path.includes("register")) data.set("email", "user@example.com");
		return post(path, data, start.cookie);
	};
	return { app, service, storage, create, error, post, start, submit };
}

describe("configured passkey callbacks", () => {
	test("registers on a cold instance and handles sessions, login, rotation, and logout automatically", async () => {
		const warm = managed();
		const cold = managed(warm.storage);
		const keys = await pair();
		// The instance issuing and accepting the ceremony has never rendered either form.
		const start = await warm.start("register", "", cold.post);
		expect(start.options.user.name).toBe("user@example.com");
		expect(start.options.user.id).not.toBe(
			Codec.Base64Url.encode(Codec.encode("user@example.com")),
		);
		const registered = await cold.submit(
			start,
			await registration(start.options.challenge, keys),
		);
		expect(registered.status).toBe(303);
		expect(registered.headers.get("location")).toBe("/account");
		expect(cold.create).toHaveBeenCalledOnce();
		expect(warm.create).not.toHaveBeenCalled();
		const cookie =
			start.cookie +
			"; " +
			registered.headers.getSetCookie().at(-1)!.split(";")[0];
		const session: Auth.Session = await (
			await warm.app.fetch(origin + "/whoami", { headers: { cookie } })
		).json();
		expect(session.id).toBe(warm.storage.records.get(id)?.user);
		const login = await warm.start("login", cookie, cold.post);
		const logged = await cold.submit(
			login,
			await assertion(login.options.challenge, keys, { handle: session.id }),
			"/auth/login",
		);
		expect(logged.status).toBe(303);
		expect(warm.storage.sessions.size).toBe(1);
		expect(warm.storage.sessions.has(session.token)).toBe(false);
		const current = logged.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const logout = await cold.post("/auth/logout", new FormData(), current);
		expect(logout.headers.get("location")).toBe("/auth");
		expect(warm.storage.sessions.size).toBe(0);
	});

	test("renders customizable fields and errors with external nonce-bearing scripts", async () => {
		const state = managed();
		const start = await state.start("register");
		expect(start.html).toContain('class="registration"');
		expect(start.html).toContain('class="error"');
		expect(start.html).toContain('nonce="csp-nonce"');
		expect(start.html).toContain('src="/_ovr/passkey/client.js"');
		expect(start.html).not.toContain("addEventListener");
		const module = await state.app.fetch(origin + "/_ovr/passkey/client.js");
		expect(module.headers.get("content-type")).toContain("text/javascript");
		expect(await module.text()).toContain("export function listen");
	});

	test("gives verification a minute beyond the configured browser timeout", async () => {
		const state = managed(setup({ timeout: 90000 }));
		const start = await state.start("register");
		expect(start.options.timeout).toBe(90000);
		const expiration = state.storage.challenges.get(start.ceremony)!.expiration;
		expect(expiration - Date.now()).toBeGreaterThan(149000);
		const keys = await pair();
		vi.spyOn(Date, "now").mockReturnValue(expiration - 1);
		try {
			expect(
				(
					await state.submit(
						start,
						await registration(start.options.challenge, keys),
					)
				).status,
			).toBe(303);
			expect(state.create).toHaveBeenCalledOnce();
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("does not issue a session when account persistence fails and keeps details out of HTTP responses", async () => {
		const state = managed();
		state.create.mockImplementationOnce(() => {
			throw new Error("private database details");
		});
		const start = await state.start("register");
		const result = await state.submit(
			start,
			await registration(start.options.challenge, await pair()),
		);
		expect(result.headers.get("location")).toBe(
			origin + "/auth?_auth=register",
		);
		expect(result.headers.getSetCookie()).toHaveLength(0);
		expect(state.storage.sessions.size).toBe(0);
		expect(state.error).toHaveBeenCalledWith(
			expect.objectContaining({ message: "private database details" }),
			expect.anything(),
		);
		const page = await state.app.fetch(result.headers.get("location")!);
		const html = await page.text();
		expect(html).toContain("If you already registered, sign in");
		expect(html).not.toContain("private database");
	});

	test("validates registration fields before prompting and supports distributed request limits", async () => {
		const allow = vi.fn(() => true);
		const state = managed(setup(), { allow });
		const start = await state.start("register");
		const set = vi.spyOn(state.storage.options.challenges, "set");
		const invalid = new FormData();
		invalid.set("bootstrap", start.bootstrap);
		invalid.set("email", "invalid");
		const response = await state.post(start.endpoint, invalid, start.cookie);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ fields: ["email"] });
		expect(set).not.toHaveBeenCalled();
		allow.mockReturnValue(false);
		const denied = await state.post(start.endpoint, invalid, start.cookie);
		expect(denied.status).toBe(429);
		expect(denied.headers.get("retry-after")).toBe("60");
		expect(set).not.toHaveBeenCalled();
	});

	test("respects a shared challenge capacity refusal", async () => {
		const state = managed();
		vi.spyOn(state.storage.options.challenges, "set").mockReturnValue(false);
		const page = await state.app.fetch(origin + "/auth");
		const html = await page.text();
		const data = new FormData();
		data.set(
			"bootstrap",
			html.match(/data-bootstrap="([^"]+)"/)![1]!.replaceAll("&quot;", '\"'),
		);
		data.set("email", "user@example.com");
		expect(
			(
				await state.post(
					"/_ovr/passkey/options/register",
					data,
					page.headers.getSetCookie()[0]!.split(";")[0],
				)
			).status,
		).toBe(429);
	});

	test("supports custom endpoints and rejects invalid paths at startup", async () => {
		const state = managed(setup(), {
			paths: {
				register: "/join/register",
				login: "/join/login",
				logout: "/join/logout",
				options: "/join/options",
				client: "/join/client.js",
			},
		});
		const start = await state.start("register");
		expect(start.endpoint).toBe("/join/options/register");
		expect(start.html).toContain('action="/join/register"');
		expect(start.html).toContain('src="/join/client.js"');
		expect(
			(
				await state.submit(
					start,
					await registration(start.options.challenge, await pair()),
					"/join/register",
				)
			).status,
		).toBe(303);
		expect(() =>
			managed(setup(), { paths: { register: "https://evil.example" } }),
		).toThrow("local paths");
		expect(() =>
			managed(setup(), { paths: { register: "/auth/login" } }),
		).toThrow("distinct");
		expect(() => managed(setup(), { timeout: 0 })).toThrow("timeout");
	});
});

test("junk traffic cannot exhaust a shared framework quota or deny another user login and logout", async () => {
	const allow = vi.fn(async () => true);
	const state = managed(setup(), { allow });
	for (let i = 0; i < 1000; i++) {
		const data = new FormData();
		data.set("bootstrap", "invalid");
		expect(
			(
				await state.post(
					"/_ovr/passkey/options/login",
					data,
					`__Host-auth-browser=attacker-${i}`,
				)
			).status,
		).toBe(400);
	}
	const start = await state.start("register");
	const keys = await pair();
	const registered = await state.submit(
		start,
		await registration(start.options.challenge, keys),
	);
	expect(registered.status).toBe(303);
	const cookie = registered.headers.getSetCookie().at(-1)!.split(";")[0]!;
	allow.mockResolvedValue(false);
	allow.mockClear();
	expect(
		(await state.post("/auth/logout", new FormData(), cookie)).status,
	).toBe(303);
	expect(allow).not.toHaveBeenCalled();
	expect(state.storage.sessions.size).toBe(0);
});

test("admission errors cannot prevent logout and unconfigured admission fails at startup", async () => {
	const state = managed();
	const { allow, ...options } = state.service;
	void allow;
	// @ts-expect-error A deployment policy must be explicit, even when the trusted edge already limits traffic.
	expect(() => Auth.passkey(options)).toThrow("allow callback");
	const blocked = managed(setup(), {
		allow: async () => {
			throw new Error("limiter unavailable");
		},
	});
	expect((await blocked.post("/auth/logout", new FormData())).status).toBe(303);
});

test("raw auth options no longer mount an unguarded options endpoint", async () => {
	const storage = setup();
	const app = new App({ auth: storage.options });
	app.use((c, next) => (c.route ? next() : c.text("Not Found", 404)));
	const data = new FormData();
	data.set("bootstrap", "invalid");
	expect(
		(
			await app.fetch(origin + "/_ovr/passkey/options", {
				method: "POST",
				headers: { origin },
				body: data,
			})
		).status,
	).toBe(404);
});

test("host mismatches return a controlled status before session reads or callbacks", async () => {
	const state = managed();
	const get = vi.spyOn(state.storage.options.sessions, "get");
	const response = await state.app.fetch("https://wrong.example/whoami");
	expect(response.status).toBe(421);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(get).not.toHaveBeenCalled();
});

test("alternate hosts can serve health checks and redirects without using authentication", async () => {
	const state = managed();
	state.app.use(
		Route.get("/health", (c) => c.text("ok")),
		Route.get("/canonical", (c) => c.redirect(origin + "/", 308)),
	);
	for (const host of [
		"https://127.0.0.1",
		"https://www.example.com",
		"https://preview.example.com",
	]) {
		const health = await state.app.fetch(host + "/health");
		expect(health.status).toBe(200);
		expect(await health.text()).toBe("ok");
		const redirect = await state.app.fetch(host + "/canonical");
		expect(redirect.status).toBe(308);
		expect(redirect.headers.get("location")).toBe(origin + "/");
	}
});

test("every generated auth endpoint rejects an alternate host before admission or storage", async () => {
	const allow = vi.fn(() => true);
	const state = managed(setup(), { allow });
	const set = vi.spyOn(state.storage.options.challenges, "set");
	for (const path of [
		"/auth/register",
		"/auth/login",
		"/auth/logout",
		"/_ovr/passkey/options/register",
		"/_ovr/passkey/options/login",
	]) {
		const response = await state.app.fetch("https://wrong.example" + path, {
			method: "POST",
			headers: { origin: "https://wrong.example" },
			body: new FormData(),
		});
		expect(response.status).toBe(421);
		expect(response.headers.get("cache-control")).toBe("no-store");
	}
	for (const method of ["GET", "HEAD"]) {
		expect(
			(
				await state.app.fetch("https://wrong.example/_ovr/passkey/client.js", {
					method,
				})
			).status,
		).toBe(421);
	}
	expect(allow).not.toHaveBeenCalled();
	expect(set).not.toHaveBeenCalled();
	expect(state.create).not.toHaveBeenCalled();
});

test("raw auth options also reject alternate hosts when a handler accesses c.auth", async () => {
	const state = setup();
	const app = new App({ auth: state.options });
	app.use(Route.get("/private", async (c) => c.json(await c.auth.session())));
	const response = await app.fetch("https://wrong.example/private");
	expect(response.status).toBe(421);
	expect(await response.text()).toBe("Misdirected Request");
});

test("configured logout reports storage failure without claiming success", async () => {
	const state = managed();
	const start = await state.start("register");
	const registered = await state.submit(
		start,
		await registration(start.options.challenge, await pair()),
	);
	const cookie = registered.headers.getSetCookie().at(-1)!.split(";")[0]!;
	vi.spyOn(state.storage.options.sessions, "delete").mockRejectedValueOnce(
		new Error("private revocation failure"),
	);
	const result = await state.post("/auth/logout", new FormData(), cookie);
	expect(result.status).toBe(503);
	expect(await result.text()).toBe("Could not log out. Try again.");
	expect(result.headers.getSetCookie()).toHaveLength(0);
	expect(state.storage.sessions.size).toBe(1);
});

test("configured options reject substituted operations and oversized bodies before storage", async () => {
	const state = managed();
	const start = await state.start("register");
	const set = vi.spyOn(state.storage.options.challenges, "set");
	const data = new FormData();
	data.set("bootstrap", start.bootstrap);
	const switched = await state.post(
		"/_ovr/passkey/options/login",
		data,
		start.cookie,
	);
	expect(switched.status).toBe(400);
	expect(state.error).toHaveBeenCalledWith(
		expect.objectContaining({ message: "Invalid bootstrap binding" }),
		expect.anything(),
	);
	data.set("email", "user@example.com");
	data.set("bootstrap", "x".repeat(129 * 1024));
	const oversized = await state.post(start.endpoint, data, start.cookie);
	expect(oversized.status).toBe(400);
	expect(set).not.toHaveBeenCalled();
});

test("a zero-counter credential requires a matched snapshot even when its values do not change", async () => {
	const storage = await enrolled();
	const state = managed(storage);
	const update = vi
		.spyOn(storage.credentials, "update")
		.mockReturnValueOnce(false);
	const rejected = await state.start("login");
	const failure = await state.submit(
		rejected,
		await assertion(rejected.options.challenge, storage.keys),
		"/auth/login",
	);
	expect(failure.headers.get("location")).toBe(origin + "/auth?_auth=login");
	expect(storage.sessions.size).toBe(0);
	const accepted = await state.start("login");
	const success = await state.submit(
		accepted,
		await assertion(accepted.options.challenge, storage.keys),
		"/auth/login",
	);
	expect(success.headers.get("location")).toBe("/account");
	expect(update).toHaveBeenCalledTimes(2);
	expect(update.mock.calls[0]?.[0]).toEqual(update.mock.calls[0]?.[1]);
	expect(storage.records.get(id)?.counter).toBe(0);
	expect(storage.sessions.size).toBe(1);
});

test("account persistence may complete before session storage fails; normal login can recover", async () => {
	const state = managed();
	const keys = await pair();
	vi.spyOn(state.storage.options.sessions, "set").mockRejectedValueOnce(
		new Error("session unavailable"),
	);
	const start = await state.start("register");
	const failed = await state.submit(
		start,
		await registration(start.options.challenge, keys),
	);
	expect(failed.headers.get("location")).toBe(origin + "/auth?_auth=register");
	expect(failed.headers.getSetCookie()).toHaveLength(0);
	expect(state.storage.records.size).toBe(1);
	expect(state.storage.sessions.size).toBe(0);
	const page = await state.app.fetch(failed.headers.get("location")!);
	expect(await page.text()).toContain("If you already registered, sign in");
	const login = await state.start("login", start.cookie);
	const result = await state.submit(
		login,
		await assertion(login.options.challenge, keys, {
			handle: state.storage.records.get(id)!.user,
		}),
		"/auth/login",
	);
	expect(result.headers.get("location")).toBe("/account");
	expect(state.create).toHaveBeenCalledOnce();
	expect(state.storage.sessions.size).toBe(1);
});

test.each(["register", "login"] as const)(
	"a denied final %s submit redirects to a recoverable form before verification",
	async (method) => {
		const retry = new Date(Date.now() + 45000);
		const allow = vi.fn((_c: unknown, phase: "options" | "verify") =>
			phase === "options" ? true : retry,
		);
		const state = managed(setup(), { allow });
		const start = await state.start(method);
		const take = vi.spyOn(state.storage.options.challenges, "take");
		const response = await state.submit(start, {}, `/auth/${method}`);
		expect(response.status).toBe(303);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const location = new URL(response.headers.get("location")!);
		expect(location.pathname).toBe("/auth");
		expect(location.searchParams.get("_auth")).toBe(method);
		expect(location.searchParams.get("_retry")).toBe(String(retry.getTime()));
		const page = await state.app.fetch(location, {
			headers: { cookie: start.cookie },
		});
		expect(await page.text()).toMatch(
			/Too many authentication requests\. Try again in \d+ seconds\./,
		);
		expect(allow.mock.calls.map((call) => call[1])).toEqual([
			"options",
			"verify",
		]);
		expect(take).not.toHaveBeenCalled();
		expect(state.create).not.toHaveBeenCalled();
		expect(state.storage.sessions.size).toBe(0);
	},
);

test("a successful ceremony makes two separately admitted requests", async () => {
	const allow = vi.fn((_c: unknown, _phase: "options" | "verify") => true);
	const state = managed(setup(), { allow });
	const start = await state.start("register");
	const response = await state.submit(
		start,
		await registration(start.options.challenge, await pair()),
	);
	expect(response.headers.get("location")).toBe("/account");
	expect(allow.mock.calls.map((call) => call[1])).toEqual([
		"options",
		"verify",
	]);
});

test.each([
	{ value: false, retry: "60" },
	{ value: 17000, retry: "17" },
	{ value: -1000, retry: "1" },
	{ value: 86400000, retry: "3600" },
	{ value: NaN, retry: null },
])(
	"admission result $value controls the retry deadline without leaking errors",
	async ({ value, retry }) => {
		const now = Date.now();
		const time = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			const state = managed(setup(), {
				allow: () =>
					typeof value === "number" ? new Date(now + value) : value,
			});
			const response = await state.post(
				"/_ovr/passkey/options/login",
				new FormData(),
			);
			expect(response.status).toBe(retry === null ? 400 : 429);
			expect(response.headers.get("retry-after")).toBe(retry);
			if (retry === null) {
				expect(await response.text()).toBe("Authentication failed. Try again.");
				expect(state.error).toHaveBeenCalledOnce();
			}
		} finally {
			time.mockRestore();
		}
	},
);

test.each(["register", "login"])(
	"caps final %s retry hints without overriding the admission policy",
	async (method) => {
		const now = Date.now();
		const time = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			const allow = vi.fn(() => new Date(now + 86400000));
			const state = managed(setup(), { allow });
			const response = await state.post(`/auth/${method}`, new FormData());
			expect(response.status).toBe(303);
			const location = new URL(response.headers.get("location")!);
			expect(location.searchParams.get("_retry")).toBe(String(now + 3600000));
			time.mockReturnValue(now + 3600000);
			const denied = await state.post(
				`/_ovr/passkey/options/${method}`,
				new FormData(),
			);
			expect(denied.status).toBe(429);
			expect(denied.headers.get("retry-after")).toBe("3600");
			expect(allow).toHaveBeenCalledTimes(2);
			expect(state.create).not.toHaveBeenCalled();
			expect(state.storage.challenges.size).toBe(0);
		} finally {
			time.mockRestore();
		}
	},
);

test("browser assets revalidate with an ETag instead of downloading unchanged code", async () => {
	const state = managed();
	const first = await state.app.fetch(origin + "/_ovr/passkey/client.js");
	const etag = first.headers.get("etag")!;
	expect(etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
	for (const value of [etag, etag.slice(2), `"other", ${etag}`, "*"]) {
		const cached = await state.app.fetch(origin + "/_ovr/passkey/client.js", {
			headers: { "if-none-match": value },
		});
		expect(cached.status).toBe(304);
		expect(await cached.text()).toBe("");
	}
	expect(
		(
			await state.app.fetch(origin + "/_ovr/passkey/client.js", {
				headers: { "if-none-match": '"old"' },
			})
		).status,
	).toBe(200);
});

test("a trusted per-request admission decision isolates denied clients without allocating challenges", async () => {
	// Real deployment adapters supply trusted peer information separately from client-controlled headers.
	const denied = new WeakSet<Request>();
	const state = managed(setup(), { allow: (c) => !denied.has(c.req) });
	const set = vi.spyOn(state.storage.options.challenges, "set");
	for (let i = 0; i < 100; i++) {
		const data = new FormData();
		data.set("bootstrap", "invalid");
		const request = new Request(origin + "/_ovr/passkey/options/login", {
			method: "POST",
			headers: { origin, cookie: `__Host-auth-browser=rotation-${i}` },
			body: data,
		});
		denied.add(request);
		expect((await state.app.fetch(request)).status).toBe(429);
	}
	expect(set).not.toHaveBeenCalled();
	const allowed = await state.start("register");
	expect(allowed.response.status).toBe(200);
	expect(set).toHaveBeenCalledOnce();
});
