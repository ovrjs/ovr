import { App } from "../app/index.js";
import { jsx } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import { Route } from "../route/index.js";
import { Field } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { Auth } from "./index.js";
import { Passkey } from "./passkey.js";
import { State } from "./state.js";
import { describe, expect, expectTypeOf, test, vi } from "vitest";

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
		authenticatorAttachment: "platform",
		clientExtensionResults: { credProps: { rk: true } },
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
			authenticatorData: Codec.Base64Url.encode(data),
			transports: ["internal", "hybrid"],
			publicKeyAlgorithm: -7,
			publicKey: Codec.Base64Url.encode(
				new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey)),
			),
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
		authenticatorAttachment: "platform",
		clientExtensionResults: {},
		response: {
			clientDataJSON: json,
			authenticatorData: Codec.Base64Url.encode(data),
			signature: Codec.Base64Url.encode(der(new Uint8Array(signature))),
			userHandle:
				handle === null ? null : Codec.Base64Url.encode(Codec.encode(handle)),
		},
	};
}

function setup(extra: Partial<State.Options> = {}) {
	const challenges = new Map<string, Auth.Challenge>();
	const sessions = new Map<string, Auth.Session>();
	const records = new Map<string, Auth.Credential>();
	// Test-only stand-in for a shared atomic backend; never part of the framework.
	const counts = new Map<string, number>();
	const consume: Limiter.Options["consume"] = (key, { limit, interval }) => {
		const count = counts.get(key) ?? 0;
		if (count >= limit) return Date.now() + interval;
		counts.set(key, count + 1);
		return true;
	};
	const credentials: Auth.Credentials = {
		get: (id) => records.get(id),
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
		limits: { consume },
		credentials,
		register: { fields: {}, name: () => "User", create: () => {} },
		...extra,
	};
	const auth = new Auth(options);
	const app = new App();
	// Internal protocol tests compose their own routes; applications use new Auth().
	const issue = (method: "register" | "login") =>
		Route.post(
			method === "register" ? endpoint : `${endpoint}/login`,
			{ bootstrap: Field.text() },
			async (c) => {
				const input = await c.data({ payload: 128 * 1024 });
				if (input.issues) throw input;
				await Passkey.issue(
					c,
					new State(c, options),
					input.data.bootstrap,
					() => "User",
					{ method, action: `/${method}` },
				);
			},
		);
	app.use(issue("register"), issue("login"), Passkey.client);
	const register = Route.post(
		"/register",
		{ email: Field.email() },
		async (c) => {
			const input = await c.data();
			if (input.issues) throw input;
			const credential = await new Passkey(c, new State(c, options)).register();
			if (records.has(credential.id)) throw new Error("Duplicate credential");
			records.set(credential.id, credential);
			c.json(credential);
		},
	);
	const login = Route.post("/login", {}, async (c) =>
		c.json(await new Passkey(c, new State(c, options)).login(credentials)),
	);
	Passkey.prepare(register);
	Passkey.prepare(login);
	app.use(
		register,
		login,
		Route.get("/register-page", (c) =>
			jsx(
				new Passkey(c, new State(c, options)).form(register, "register", {
					endpoint,
				}),
				{},
			),
		),
		Route.get("/login-page", (c) =>
			jsx(
				new Passkey(c, new State(c, options)).form(login, "login", {
					endpoint: `${endpoint}/login`,
				}),
				{},
			),
		),
		Route.get("/session", async (c) => c.json(await auth.session(c))),
		Route.post("/session", async (c) => c.json(await auth.login(c, user))),
		Route.post("/logout", async (c) => c.json(await auth.logout(c))),
		Route.post("/revoke/:id", async (c) => {
			await auth.revoke(c, c.params.id);
			c.text("revoked");
		}),
	);
	const post = (path: string, data: FormData, cookie = "", ip = "192.0.2.1") =>
		app.fetch(origin + path, {
			ip,
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
		const response = await post(
			method === "register" ? endpoint : `${endpoint}/login`,
			data,
			cookie,
		);
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
		// Login accepts only the reserved passkey fields.
		if (path !== "/register") data.delete("email");
		return post(path, data, cookie);
	};
	return {
		app,
		auth,
		consume,
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
	extra: Partial<State.Options> = {},
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
	return {
		...state,
		keys,
		cookie: start.cookie,
		user: state.records.get(id)!.user,
	};
}

describe("passkey ceremonies", () => {
	test("registers an actual P-256 key and verifies its signed login", async () => {
		const state = await enrolled();
		const login = await state.start("login", state.cookie);
		const response = await state.submit(
			login,
			await assertion(login.options.challenge, state.keys, {
				counter: 1,
				handle: state.user,
			}),
			"/login",
		);
		expect(await response.json()).toMatchObject({
			id,
			user: state.user,
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
		const credential = await assertion(login.options.challenge, state.keys, {
			handle: state.user,
		});
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
				await assertion(login.options.challenge, await pair(), {
					handle: state.user,
				}),
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
					await assertion(login.options.challenge, state.keys, {
						counter,
						handle: state.user,
					}),
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
			await assertion(login.options.challenge, state.keys, {
				flags: 0x1d,
				handle: state.user,
			}),
			"/login",
		);
		expect(state.records.get(id)?.backedUp).toBe(true);
		const changed = await state.start("login", state.cookie);
		await expect(
			state.submit(
				changed,
				await assertion(changed.options.challenge, state.keys, {
					handle: state.user,
				}),
				"/login",
			),
		).rejects.toThrow("eligibility");
		vi.spyOn(state.credentials, "update").mockResolvedValue(false);
		const stale = await state.start("login", state.cookie);
		await expect(
			state.submit(
				stale,
				await assertion(stale.options.challenge, state.keys, {
					flags: 0x1d,
					handle: state.user,
				}),
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
	test("one Auth service isolates concurrent requests and caches only within each request", async () => {
		const state = setup();
		const [first, second] = await Promise.all([
			state.post("/session", new FormData()),
			state.post("/session", new FormData()),
		]);
		const sessions: Auth.Session[] = await Promise.all([
			first.json(),
			second.json(),
		]);
		expect(sessions[0]?.id).not.toBe(sessions[1]?.id);
		expect(sessions.map((session) => session.user)).toEqual([user, user]);
		for (const session of sessions) {
			expect(session.id).not.toBe(user);
			expect(state.sessions.get(session.id)).toEqual(session);
			expect(session).not.toHaveProperty("token");
		}
		expect(state.sessions.size).toBe(2);
		const cookies = [first, second].map(
			(response) => response.headers.getSetCookie().at(-1)!.split(";")[0]!,
		);
		const get = vi.spyOn(state.options.sessions, "get");
		state.app.use(
			Route.get("/cached", async (c) => {
				const first = state.auth.session(c);
				expect(state.auth.session(c)).toBe(first);
				c.json(await first);
			}),
		);
		const responses = await Promise.all(
			cookies.map((cookie) =>
				state.app.fetch(origin + "/cached", { headers: { cookie } }),
			),
		);
		expect(
			await Promise.all(responses.map((response) => response.json())),
		).toEqual(sessions);
		expect(get).toHaveBeenCalledTimes(2);
	});

	test("logout and revoke update the same request's cached session and cookie", async () => {
		const state = setup();
		const login = await state.post("/session", new FormData());
		const session: Auth.Session = await login.json();
		const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
		state.app.use(
			Route.get("/revoke-current", async (c) => {
				await state.auth.revoke(c, session.id);
				expect(await state.auth.session(c)).toBeNull();
				c.text("revoked");
			}),
		);
		const response = await state.app.fetch(origin + "/revoke-current", {
			headers: { cookie },
		});
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(state.sessions.size).toBe(0);
	});

	test("rejects a stored session whose ID differs from the signed cookie", async () => {
		const state = setup();
		const login = await state.post("/session", new FormData());
		const session: Auth.Session = await login.json();
		const get = vi
			.spyOn(state.options.sessions, "get")
			.mockReturnValueOnce({ ...session, id: session.user });
		const response = await state.app.fetch(origin + "/session", {
			headers: { cookie: login.headers.getSetCookie().at(-1)!.split(";")[0]! },
		});
		expect(get).toHaveBeenCalledWith(session.id);
		expect(await response.json()).toBeNull();
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
	});

	test.each([false, true])(
		"revokes the current session directly with cached=%s",
		async (cached) => {
			const state = setup();
			const login = await state.post("/session", new FormData());
			const session: Auth.Session = await login.json();
			const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
			const get = vi.spyOn(state.options.sessions, "get");
			state.app.use(
				Route.get("/direct-revoke", async (c) => {
					if (cached) await state.auth.session(c);
					get.mockRejectedValue(new Error("reads unavailable"));
					await state.auth.revoke(c, session.id);
					expect(await state.auth.session(c)).toBeNull();
					c.text("revoked");
				}),
			);
			const response = await state.app.fetch(origin + "/direct-revoke", {
				headers: { cookie },
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
			expect(get).toHaveBeenCalledTimes(cached ? 1 : 0);
			expect(state.sessions.size).toBe(0);
		},
	);

	test("revoking the incoming session after rotation preserves the new session", async () => {
		const state = setup();
		const login = await state.post("/session", new FormData());
		const previous: Auth.Session = await login.json();
		const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
		state.app.use(
			Route.get("/rotate-revoke", async (c) => {
				const session = await state.auth.login(c, "next-user");
				await state.auth.revoke(c, previous.id);
				expect(await state.auth.session(c)).toEqual(session);
				c.json(session);
			}),
		);
		const response = await state.app.fetch(origin + "/rotate-revoke", {
			headers: { cookie },
		});
		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie().at(-1)).not.toContain("Max-Age=0");
		expect(state.sessions.size).toBe(1);
	});

	test.each(["", " ", "x".repeat(1025), "é".repeat(513)])(
		"rejects invalid session user IDs before persistence: %s",
		async (id) => {
			const state = setup();
			const get = vi.spyOn(state.options.sessions, "get");
			const set = vi.spyOn(state.options.sessions, "set");
			state.app.use(
				Route.get("/invalid-user", async (c) => {
					await expect(state.auth.login(c, id)).rejects.toThrow("user ID");
					c.text("rejected");
				}),
			);
			expect((await state.app.fetch(origin + "/invalid-user")).status).toBe(
				200,
			);
			expect(get).not.toHaveBeenCalled();
			expect(set).not.toHaveBeenCalled();
		},
	);

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
		await state.post(`/revoke/${session.id}`, new FormData());
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
	test("exports namespaced auth issues and public context and persistence types", async () => {
		const api = await import("../index.js");
		expect(api.Auth.Issue).toBe(Auth.Issue);
		expect(api).not.toHaveProperty("AuthIssue");
		expectTypeOf<Auth.Issue>().toExtend<Error>();
		expectTypeOf<keyof Auth.Session>().toEqualTypeOf<
			"id" | "user" | "expiration"
		>();
		expectTypeOf<keyof Auth.Credentials>().toEqualTypeOf<"get" | "update">();
		expectTypeOf<Parameters<Auth["session"]>[0]>().toEqualTypeOf<
			Pick<Auth.Context, "url" | "cookie" | "res">
		>();
		if (false) {
			// @ts-expect-error The promise helper is internal.
			const result: Auth.Result<string> = "";
			void result;
		}
	});

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
				const Register = new Passkey(c, new State(c, state.options)).form(
					route,
					"register",
					{ endpoint, nonce: "nonce</script><script>alert(1)</script>" },
				);
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
				new Passkey(c, new State(c, state.options)).form(route, "register", {
					endpoint,
				});
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
	extra: Partial<Auth.Options<{ email: ReturnType<typeof Field.email> }>> = {},
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
	const service = new Auth({
		...storage.options,
		limits: { consume: storage.consume },
		credentials: storage.credentials,
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
				// @ts-expect-error Authentication methods live on the configured service.
				c.auth;
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
		Route.get("/whoami", async (c) => c.json(await service.session(c))),
	);
	const post = (path: string, data: FormData, cookie = "", ip = "192.0.2.1") =>
		app.fetch(origin + path, {
			ip,
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

function policy() {
	const consume: Limiter.Options["consume"] = () => true;
	const limiter = new Limiter({ consume });
	return {
		consume,
		register: limiter,
		login: limiter,
		check: vi.spyOn(limiter, "check"),
	};
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
		const credential = await registration(start.options.challenge, keys);
		// Derive the key from attestation, ignoring the native JSON convenience field.
		credential.response.publicKey = Codec.Base64Url.encode(Uint8Array.of(0));
		const registered = await cold.submit(start, credential);
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
		expect(session.user).toBe(warm.storage.records.get(id)?.user);
		const login = await warm.start("login", cookie, cold.post);
		const logged = await cold.submit(
			login,
			await assertion(login.options.challenge, keys, { handle: session.user }),
			"/auth/login",
		);
		expect(logged.status).toBe(303);
		expect(warm.storage.sessions.size).toBe(1);
		expect(warm.storage.sessions.has(session.id)).toBe(false);
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

	test("uses a fixed one-minute browser hint and two-minute ceremony lifetime", async () => {
		const state = managed();
		const start = await state.start("register");
		expect(start.options.timeout).toBe(60000);
		expect(start.options.rp).toEqual({
			id: "example.com",
			name: "example.com",
		});
		expect(start.options.excludeCredentials).toBeUndefined();
		const expiration = state.storage.challenges.get(start.ceremony)!.expiration;
		expect(expiration - Date.now()).toBeGreaterThan(119000);
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
		const limits = policy();
		const check = limits.check;
		const state = managed(setup(), { limits });
		const start = await state.start("register");
		const set = vi.spyOn(state.storage.options.challenges, "set");
		const invalid = new FormData();
		invalid.set("bootstrap", start.bootstrap);
		invalid.set("email", "invalid");
		const response = await state.post(start.endpoint, invalid, start.cookie);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ fields: ["email"] });
		expect(set).not.toHaveBeenCalled();
		check.mockResolvedValue(new Date(Date.now() + 60000));
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
			},
		});
		const start = await state.start("register");
		expect(start.endpoint).toBe("/_ovr/passkey/options/register");
		expect(start.html).toContain('action="/join/register"');
		expect(start.html).toContain('src="/_ovr/passkey/client.js"');
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
	});
});

test("automatic policies ignore cookie rotation, isolate clients, and leave logout available", async () => {
	const state = managed();
	const time = vi.spyOn(Date, "now").mockReturnValue(Date.now());
	try {
		for (let i = 0; i < 40; i++) {
			const data = new FormData();
			data.set("bootstrap", "invalid");
			const response = await state.post(
				"/_ovr/passkey/options/login",
				data,
				`__Host-auth-browser=rotation-${i}`,
			);
			expect(response.status).toBe(i < 20 ? 400 : 429);
		}
		const data = new FormData();
		data.set("bootstrap", "invalid");
		expect(
			(await state.post("/_ovr/passkey/options/login", data, "", "192.0.2.2"))
				.status,
		).toBe(400);
		const start = await state.start("register");
		const registered = await state.submit(
			start,
			await registration(start.options.challenge, await pair()),
		);
		expect(registered.status).toBe(303);
		const cookie = registered.headers.getSetCookie().at(-1)!.split(";")[0]!;
		expect(
			(await state.post("/auth/logout", new FormData(), cookie)).status,
		).toBe(303);
		expect(state.storage.sessions.size).toBe(0);
	} finally {
		time.mockRestore();
	}
});

test("auth requires shared rate-limit storage at startup", () => {
	const storage = setup();
	expect(
		() =>
			new Auth({
				...storage.options,
				// @ts-expect-error A shared backend is required; the framework has no implicit counters.
				limits: undefined,
				credentials: storage.credentials,
				register: { fields: {}, name: () => "User", create: () => {} },
			}),
	).toThrow("limits.consume");
});

test("auth rejects client limiter arrays at startup", () => {
	const storage = setup();
	for (const method of ["register", "login"]) {
		expect(() =>
			managed(storage, { limits: { consume: storage.consume, [method]: [] } }),
		).toThrow("client policies");
	}
});

test.each([
	{ method: "register", limit: 5, first: "192.0.2.1", other: "192.0.2.2" },
	{ method: "login", limit: 20, first: "192.0.2.1", other: "192.0.2.2" },
	{
		method: "register",
		limit: 5,
		first: "2001:db8:1:1::1",
		other: "2001:db8:1:2::1",
	},
	{
		method: "login",
		limit: 20,
		first: "2001:db8:1:1::1",
		other: "2001:db8:1:2::1",
	},
])(
	"blocked $method traffic from $first cannot drain extra shared budgets",
	async ({ method, limit, first, other }) => {
		const storage = setup();
		const network = new Limiter({
			name: "network",
			prefix: 48,
			limit: 40,
			consume: storage.consume,
		});
		const global = new Limiter({
			name: "aggregate",
			key: () => "all",
			limit: 100,
			consume: storage.consume,
		});
		const shared = [network, global];
		const checks = shared.map((limiter) => vi.spyOn(limiter, "check"));
		const limits = {
			consume: storage.consume,
			guard: new Limiter({
				name: "creation",
				key: () => "all",
				limit: 1000,
				consume: storage.consume,
			}),
			extra: shared,
		};
		const warm = managed(storage, { limits });
		const cold = managed(storage, { limits });
		const guard = vi.spyOn(limits.guard, "check");
		shared.length = 0; // Extra policies are snapshotted too.
		const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
		try {
			for (const phase of ["options", "verify"]) {
				const path =
					phase === "options"
						? `/_ovr/passkey/options/${method}`
						: `/auth/${method}`;
				const data = new FormData();
				data.set("bootstrap", "invalid");
				data.set("email", "user@example.com");
				for (let i = 0; i < 120; i++) {
					const response = await (i % 2 ? warm : cold).post(
						path,
						data,
						"",
						first,
					);
					expect(response.status).toBe(
						phase === "verify" ? 303 : i < limit ? 400 : 429,
					);
					if (phase === "verify")
						expect(
							new URL(response.headers.get("location")!).searchParams.has(
								"_retry",
							),
						).toBe(i >= limit);
				}
				const response = await cold.post(path, data, "", other);
				expect(response.status).toBe(phase === "options" ? 400 : 303);
				if (phase === "verify")
					expect(
						new URL(response.headers.get("location")!).searchParams.has(
							"_retry",
						),
					).toBe(false);
				for (const check of checks)
					expect(
						check.mock.calls.filter(([, scope]) => scope === phase),
					).toHaveLength(limit + 1);
				expect(
					guard.mock.calls.filter(([, scope]) => scope === phase),
				).toHaveLength(121); // Client-denied attempts still reach the guard, but skip extras.
			}
			expect(storage.challenges.size).toBe(0);
			expect(warm.create).not.toHaveBeenCalled();
			expect(cold.create).not.toHaveBeenCalled();
		} finally {
			clock.mockRestore();
		}
	},
);

test("a generous guard bounds client-record creation before the default and extra policies", async () => {
	const storage = setup();
	const consume = vi.fn(storage.consume);
	const guard = new Limiter({
		name: "creation",
		key: () => "all",
		limit: 3,
		consume,
	});
	const aggregate = new Limiter({
		name: "aggregate",
		key: () => "all",
		limit: 2,
		consume,
	});
	const check = vi.spyOn(aggregate, "check");
	const state = managed(storage, {
		limits: { consume, guard, extra: [aggregate] },
	});
	for (let i = 0; i < 10; i++) {
		const response = await state.post(
			"/_ovr/passkey/options/login",
			new FormData(),
			"",
			`192.0.2.${i + 1}`,
		);
		expect(response.status).toBe(i < 2 ? 400 : 429);
	}
	expect(
		consume.mock.calls.filter(([, policy]) => policy.limit === 20),
	).toHaveLength(3);
	expect(check).toHaveBeenCalledTimes(3);
	expect(storage.challenges.size).toBe(0);
	const hits = consume.mock.calls.length;
	expect((await state.post("/auth/logout", new FormData())).status).toBe(303);
	expect(consume).toHaveBeenCalledTimes(hits);
});

test("a failed creation guard stops backend access and extra checks but leaves logout available", async () => {
	const storage = setup();
	const consume = vi.fn(storage.consume);
	const guard = new Limiter({
		consume: () => {
			throw new Error("private creation guard failure");
		},
	});
	const extra = new Limiter({ consume });
	const check = vi.spyOn(extra, "check");
	const state = managed(storage, {
		limits: { consume, guard, extra: [extra] },
	});
	const response = await state.post(
		"/_ovr/passkey/options/login",
		new FormData(),
	);
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private creation");
	expect(state.error).toHaveBeenCalledOnce();
	expect(consume).not.toHaveBeenCalled();
	expect(check).not.toHaveBeenCalled();
	expect(storage.challenges.size).toBe(0);
	expect((await state.post("/auth/logout", new FormData())).status).toBe(303);
});

test("optional guard and extra policies are validated at startup", () => {
	const storage = setup();
	expect(() =>
		// @ts-expect-error Runtime configuration must also reject non-Limiter guards.
		managed(storage, { limits: { consume: storage.consume, guard: {} } }),
	).toThrow("limits.guard");
	expect(() =>
		// @ts-expect-error Runtime configuration must also reject non-Limiter extra entries.
		managed(storage, { limits: { consume: storage.consume, extra: [{}] } }),
	).toThrow("limits.extra");
	expect(() =>
		managed(storage, { limits: { consume: storage.consume, extra: [] } }),
	).not.toThrow();
	expect(() =>
		managed(storage, {
			limits: { consume: storage.consume, extra: Array<Limiter>(1) },
		}),
	).toThrow("limits.extra");
});

test("layered policies stop prefix sweeping across instances and share an aggregate ceiling", async () => {
	const storage = setup();
	const global = new Limiter({
		name: "aggregate",
		limit: 3,
		key: () => "all",
		consume: storage.consume,
	});
	const network = new Limiter({
		name: "network",
		limit: 2,
		prefix: 48,
		consume: storage.consume,
	});
	const stack = [network, global];
	const limits = { consume: storage.consume, extra: stack };
	const first = managed(storage, { limits });
	const second = managed(storage, { limits });
	stack.length = 0; // The configured services own snapshots, not the caller's mutable array.
	const calls = vi.spyOn(global, "check");
	const start = await first.start("login", "", (path, data, cookie) =>
		first.post(path, data, cookie, "2001:db8:1:1::1"),
	);
	expect(
		(
			await second.start("register", "", (path, data, cookie) =>
				second.post(path, data, cookie, "2001:db8:1:2::1"),
			)
		).response.status,
	).toBe(200);
	const denied = await first.post(
		start.endpoint,
		new FormData(),
		"",
		"2001:db8:1:3::1",
	);
	expect(denied.status).toBe(429);
	expect(calls).toHaveBeenCalledTimes(2);
	const other = await second.start("login", "", (path, data, cookie) =>
		second.post(path, data, cookie, "2001:db8:2:1::1"),
	);
	expect(other.response.status).toBe(200); // A denied /48 never consumes the later global budget.
	expect(
		(await first.post(start.endpoint, new FormData(), "", "2001:db8:3:1::1"))
			.status,
	).toBe(429);
	expect(calls).toHaveBeenCalledTimes(4);
	expect(storage.challenges.size).toBe(3);
	expect(first.create).not.toHaveBeenCalled();
	expect(second.create).not.toHaveBeenCalled();
	expect((await first.post("/auth/logout", new FormData())).status).toBe(303);
});

test("a failing layer prevents challenge writes and preserves generic errors", async () => {
	const storage = setup();
	const earlier = new Limiter({ consume: storage.consume });
	const failed = new Limiter({
		consume: () => {
			throw new Error("private backend failure");
		},
	});
	const later = new Limiter({ consume: storage.consume });
	const check = vi.spyOn(later, "check");
	const state = managed(storage, {
		limits: {
			consume: storage.consume,
			login: earlier,
			extra: [failed, later],
		},
	});
	const response = await state.post(
		"/_ovr/passkey/options/login",
		new FormData(),
	);
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private backend");
	expect(state.error).toHaveBeenCalledOnce();
	expect(check).not.toHaveBeenCalled();
	expect(storage.challenges.size).toBe(0);
});

test("limiter errors cannot prevent logout", async () => {
	const limits = policy();
	limits.check.mockRejectedValue(new Error("limiter unavailable"));
	const state = managed(setup(), { limits });
	expect((await state.post("/auth/logout", new FormData())).status).toBe(303);
	expect(limits.check).not.toHaveBeenCalled();
});

test("auth fails closed without trusted peer information and ignores spoofed IP headers", async () => {
	const state = managed();
	const set = vi.spyOn(state.storage.options.challenges, "set");
	const response = await state.app.fetch(
		origin + "/_ovr/passkey/options/login",
		{
			method: "POST",
			headers: {
				origin,
				"x-forwarded-for": "192.0.2.1",
				"cf-connecting-ip": "192.0.2.1",
			},
			body: new FormData(),
		},
	);
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("trusted client IP");
	expect(set).not.toHaveBeenCalled();
	expect(state.error).toHaveBeenCalledOnce();
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
	const limits = policy();
	const check = limits.check;
	const state = managed(setup(), { limits });
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
	expect(check).not.toHaveBeenCalled();
	expect(set).not.toHaveBeenCalled();
	expect(state.create).not.toHaveBeenCalled();
});

test("auth helpers enforce their origin even without App auth integration", async () => {
	const state = setup();
	const app = new App();
	app.use(
		Route.get("/private", async (c) => c.json(await state.auth.session(c))),
	);
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
	expect(state.error.mock.calls[0]?.[0]).toBeInstanceOf(Auth.Issue);
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
		await assertion(rejected.options.challenge, storage.keys, {
			handle: storage.user,
		}),
		"/auth/login",
	);
	expect(failure.headers.get("location")).toBe(origin + "/auth?_auth=login");
	expect(storage.sessions.size).toBe(0);
	const accepted = await state.start("login");
	const success = await state.submit(
		accepted,
		await assertion(accepted.options.challenge, storage.keys, {
			handle: storage.user,
		}),
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
		const limits = policy();
		const check = limits.check.mockImplementation(async (_c, phase) =>
			phase === "options" ? true : retry,
		);
		const state = managed(setup(), { limits });
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
		expect(check.mock.calls.map((call) => call[1])).toEqual([
			"options",
			"verify",
		]);
		expect(take).not.toHaveBeenCalled();
		expect(state.create).not.toHaveBeenCalled();
		expect(state.storage.sessions.size).toBe(0);
	},
);

test("a successful ceremony makes two separately admitted requests", async () => {
	const limits = policy();
	const check = limits.check;
	const state = managed(setup(), { limits });
	const start = await state.start("register");
	const response = await state.submit(
		start,
		await registration(start.options.challenge, await pair()),
	);
	expect(response.headers.get("location")).toBe("/account");
	expect(check.mock.calls.map((call) => call[1])).toEqual([
		"options",
		"verify",
	]);
});

test.each([
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
			const limits = policy();
			limits.check.mockResolvedValue(new Date(now + value));
			const state = managed(setup(), { limits });
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
			const limits = policy();
			const check = limits.check.mockResolvedValue(new Date(now + 86400000));
			const state = managed(setup(), { limits });
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
			expect(check).toHaveBeenCalledTimes(2);
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

test("signup options and verification have independent default budgets", async () => {
	const state = managed();
	const time = vi.spyOn(Date, "now").mockReturnValue(Date.now());
	try {
		const start = await state.start("register");
		for (let i = 0; i < 5; i++) {
			const data = new FormData();
			data.set("bootstrap", "invalid");
			data.set("email", "user@example.com");
			expect((await state.post(start.endpoint, data)).status).toBe(
				i < 4 ? 400 : 429,
			);
		}
		const response = await state.submit(
			start,
			await registration(start.options.challenge, await pair()),
		);
		expect(response.headers.get("location")).toBe("/account");
		expect(state.create).toHaveBeenCalledOnce();
	} finally {
		time.mockRestore();
	}
});

test("a shared backend retains the built-in auth policies across service instances", async () => {
	const entries = new Set<string>();
	const consume = vi.fn(async (key: string, _policy: Limiter.Policy) => {
		if (entries.has(key)) return Date.now() + 60000;
		entries.add(key);
		return true;
	});
	const first = managed(setup(), { limits: { consume } });
	const second = managed(first.storage, { limits: { consume } });
	const start = await first.start("register");
	expect((await second.post(start.endpoint, new FormData())).status).toBe(429);
	expect(consume.mock.calls[0]?.[1]).toEqual({ limit: 5, interval: 600000 });
	expect(consume.mock.calls[0]?.[0]).toBe(consume.mock.calls[1]?.[0]);
	const response = await second.submit(
		start,
		await registration(start.options.challenge, await pair()),
	);
	expect(response.headers.get("location")).toBe("/account");
	expect(consume.mock.calls[2]?.[0]).not.toBe(consume.mock.calls[0]?.[0]);
});
