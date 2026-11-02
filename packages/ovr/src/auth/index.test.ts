import { App } from "../app/index.js";
import { Database } from "../database/index.js";
import { jsx } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import { Route } from "../route/index.js";
import { Field, Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Codec, Time } from "../util/index.js";
import { Auth } from "./index.js";
import { Passkey } from "./passkey.js";
import { State } from "./state.js";
import { Storage } from "./storage.js";
import { PGlite } from "@electric-sql/pglite";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	test,
	vi,
} from "vitest";

const origin = "https://example.com";
const endpoint = "/_passkey/options";
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

/** PGlite has one session, so a transaction holds it until released. */
const engine = await PGlite.create();
let session = Promise.resolve();
const acquire = () => {
	let release!: () => void;
	const previous = session;
	session = new Promise((resolve) => (release = resolve));
	return previous.then(() => release);
};
const run = async (text: string, values?: unknown[]) =>
	values?.length
		? engine.query(text, values)
		: ((await engine.exec(text)).at(-1) ?? { rows: [] });
const users = new Table("users", {
	id: Schema.string(),
	email: Schema.string(),
});
const db = new Database(
	{
		async query(text, values) {
			const release = await acquire();
			try {
				return await run(text, values);
			} finally {
				release();
			}
		},
		async connect() {
			return { query: run, release: await acquire() };
		},
	},
	[users, ...Auth.tables],
);
// the shipped migration, so these tests cover it too
await engine.exec(
	`CREATE TABLE users (id text PRIMARY KEY, email text NOT NULL);\n${Auth.sql[1]}`,
);
const storage = Storage.of(db);

beforeEach(() =>
	engine.exec(
		"TRUNCATE users, ovr_credentials, ovr_sessions, ovr_challenges, ovr_limits",
	),
);
// the store is shared, so spies on it must not leak between tests
afterEach(() => vi.restoreAllMocks());
afterAll(() => engine.close());

/** Rows stored in an authentication table. */
const rows = async <T extends Table.Any>(table: T) =>
	(await db.sql`SELECT * FROM ${table}`.parse<unknown>(
		table,
	)) as Schema.Infer<T>[];

/** Storage inspection shared by every service on the test database. */
const inspect = {
	size: async (table: (typeof Auth.tables)[number]) =>
		(await rows(table)).length,
	record: async (id: string) =>
		(await storage.credentials.get(id)) ?? undefined,
	session: async (id: string) =>
		(await rows(db.ovr_sessions)).find((session) => session.id === id),
	challenge: async (id: string) =>
		(await rows(db.ovr_challenges)).find((challenge) => challenge.id === id),
	/** Change a stored challenge, as another instance or an attacker could. */
	edit: async (
		id: string,
		values: Partial<Schema.Infer<typeof db.ovr_challenges>>,
	) => {
		await db.sql`UPDATE ${db.ovr_challenges} SET ${db.sql.set(db.ovr_challenges, values)} WHERE id = ${id}`;
	},
};

function setup(extra: Partial<State.Options> = {}) {
	const credentials = storage.credentials;
	const options: State.Options = {
		secret: "test-secret-with-at-least-32-bytes",
		origin,
		challenges: storage.challenges,
		sessions: storage.sessions,
		...extra,
	};
	const settings: Auth.Options = {
		secret: options.secret,
		origin: options.origin,
		...(options.duration === undefined ? {} : { duration: options.duration }),
		database: db,
		register: { fields: {}, name: () => "User", create: () => {} },
	};
	const auth = new Auth(settings);
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
			await db.sql`INSERT INTO ${db.ovr_credentials} ${db.sql.values(db.ovr_credentials, credential)}`;
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
		...inspect,
		app,
		auth,
		credentials,
		options,
		settings,
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
		user: (await state.record(id))!.user,
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
		expect((await state.record(id))?.counter).toBe(1);
		expect(await state.size(db.ovr_challenges)).toBe(0);
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
		const tampered = new FormData();
		tampered.set("bootstrap", start.bootstrap + "x");
		await expect(
			state.post(endpoint, tampered, start.cookie),
		).rejects.toThrow();
		for (const cookie of ["", "__Host-auth-browser=other"]) {
			const data = new FormData();
			data.set("bootstrap", start.bootstrap);
			expect((await state.post(endpoint, data, cookie)).status).toBe(410);
		}
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + Time.hour + 1);
		try {
			const data = new FormData();
			data.set("bootstrap", start.bootstrap);
			expect((await state.post(endpoint, data, start.cookie)).status).toBe(410);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("consumes expired challenges and rejects the wrong route or ceremony", async () => {
		const state = setup();
		const start = await state.start("register");
		await state.edit(start.ceremony, { expiration: Date.now() - 1 });
		await expect(state.submit(start, {})).rejects.toThrow("expired");
		const wrong = await state.start("register", start.cookie);
		await expect(state.submit(wrong, {}, "/login")).rejects.toThrow("binding");
		expect(await state.size(db.ovr_challenges)).toBe(0);
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
		expect(await state.size(db.ovr_credentials)).toBe(0);
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
		expect((await state.record(id))?.backedUp).toBe(true);
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
	test("uses the default session lifetime when duration is explicitly undefined", async () => {
		// @ts-expect-error JavaScript callers can explicitly pass undefined.
		const state = setup({ duration: undefined });
		const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
		try {
			const response = await state.post("/session", new FormData());
			const session: Auth.Session = await response.json();
			const cookie = response.headers.getSetCookie().at(-1)!;
			expect((await state.session(session.id))?.expiration).toBe(
				Date.now() + Time.week,
			);
			expect(cookie).toContain(`Max-Age=${Time.week / Time.second}`);
			expect(
				await (
					await state.app.fetch(origin + "/session", {
						headers: { cookie: cookie.split(";")[0]! },
					})
				).json(),
			).toEqual(session);
		} finally {
			clock.mockRestore();
		}
	});

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
			expect(await state.session(session.id)).toEqual(session);
			expect(session).not.toHaveProperty("token");
		}
		expect(await state.size(db.ovr_sessions)).toBe(2);
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
		expect(await state.size(db.ovr_sessions)).toBe(0);
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
			expect(await state.size(db.ovr_sessions)).toBe(0);
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
		expect(await state.size(db.ovr_sessions)).toBe(1);
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
		expect(await state.size(db.ovr_sessions)).toBe(0);
	});

	test("rotates sessions and supports explicit revocation", async () => {
		const state = setup();
		const first = await state.post("/session", new FormData());
		const cookie = first.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const second = await state.post("/session", new FormData(), cookie);
		const session: Auth.Session = await second.json();
		expect(await state.size(db.ovr_sessions)).toBe(1);
		expect(
			await (
				await state.app.fetch(origin + "/session", { headers: { cookie } })
			).json(),
		).toBeNull();
		await state.post(`/revoke/${session.id}`, new FormData());
		expect(await state.size(db.ovr_sessions)).toBe(0);
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
		expectTypeOf<keyof Auth.Credential>().toEqualTypeOf<
			"id" | "user" | "publicKey" | "counter" | "eligible" | "backedUp"
		>();
		expectTypeOf(Auth.tables.map((table) => table.name)).toEqualTypeOf<
			("ovr_credentials" | "ovr_sessions" | "ovr_challenges" | "ovr_limits")[]
		>();
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
		expect(html).toContain('src="/_passkey/client.js"');
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
		await state.edit(start.ceremony, { action: "/register/other" });
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
		expect(await state.size(db.ovr_credentials)).toBe(0);
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
		expect(await state.size(db.ovr_credentials)).toBe(0);
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
		async (t: Database.Transaction, data: { email: string }, user: string) => {
			expect(data).toEqual({ email: "user@example.com" });
			await t.sql`INSERT INTO ${users} ${t.sql.values(users, { id: user, ...data })}`;
		},
	);
	const error = vi.fn();
	const service = new Auth({
		...storage.settings,
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
		Route.get("/login", (c) => {
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
		const page = await app.fetch(origin + "/login", { headers: { cookie } });
		const html = await page.text();
		const script = [...html.matchAll(/<script[^>]+>/g)]
			.map((v) => v[0])
			.find((v) => v.includes(`data-passkey="${method}"`))!;
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

/** Tokens a policy has spent, by bucket name and scope; freeze the clock so none refill. */
const spent = async (name: string, scope?: string) =>
	(await rows(db.ovr_limits))
		.map((bucket) => ({ key: JSON.parse(bucket.key), tokens: bucket.tokens }))
		.filter(
			({ key }) => key[0] === name && (scope === undefined || key[3] === scope),
		)
		.reduce((sum, { key, tokens }) => sum + key[1] - tokens, 0);

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
		expect(session.user).toBe((await warm.storage.record(id))?.user);
		const login = await warm.start("login", cookie, cold.post);
		const logged = await cold.submit(
			login,
			await assertion(login.options.challenge, keys, { handle: session.user }),
			"/auth/login",
		);
		expect(logged.status).toBe(303);
		expect(await warm.storage.size(db.ovr_sessions)).toBe(1);
		expect(await warm.storage.session(session.id)).toBeUndefined();
		const current = logged.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const logout = await cold.post("/auth/logout", new FormData(), current);
		expect(logout.headers.get("location")).toBe("/login");
		expect(await warm.storage.size(db.ovr_sessions)).toBe(0);
	});

	test("renders customizable fields and errors with external nonce-bearing scripts", async () => {
		const state = managed();
		const start = await state.start("register");
		expect(start.html).toContain('class="registration"');
		expect(start.html).toContain('class="error"');
		expect(start.html).toContain('nonce="csp-nonce"');
		expect(start.html).toContain('src="/_passkey/client.js"');
		expect(start.html).not.toContain("addEventListener");
		const module = await state.app.fetch(origin + "/_passkey/client.js");
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
		const expiration = (await state.storage.challenge(start.ceremony))!
			.expiration;
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
			origin + "/login?_auth=register",
		);
		expect(result.headers.getSetCookie()).toHaveLength(0);
		expect(await state.storage.size(db.ovr_sessions)).toBe(0);
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
		const check = vi.spyOn(Limiter.prototype, "check");
		const state = managed(setup());
		const start = await state.start("register");
		const set = vi.spyOn(state.storage.options.challenges, "set");
		const invalid = new FormData();
		invalid.set("bootstrap", start.bootstrap);
		invalid.set("email", "invalid");
		const response = await state.post(start.endpoint, invalid, start.cookie);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ fields: ["email"] });
		expect(set).not.toHaveBeenCalled();
		expect(check).toHaveBeenCalledOnce();
		check.mockResolvedValue(new Date(Date.now() + 60000));
		invalid.set("email", "user@example.com");
		const denied = await state.post(start.endpoint, invalid, start.cookie);
		expect(denied.status).toBe(429);
		expect(denied.headers.get("retry-after")).toBe("60");
		expect(set).not.toHaveBeenCalled();
	});

	test("respects a shared challenge capacity refusal", async () => {
		const state = managed();
		vi.spyOn(state.storage.options.challenges, "set").mockReturnValue(false);
		const page = await state.app.fetch(origin + "/login");
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
					"/_passkey/options/register",
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
		expect(start.endpoint).toBe("/_passkey/options/register");
		expect(start.html).toContain('action="/join/register"');
		expect(start.html).toContain('src="/_passkey/client.js"');
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
				"/_passkey/options/login",
				data,
				`__Host-auth-browser=rotation-${i}`,
			);
			expect(response.status).toBe(i < 20 ? 400 : 429);
		}
		const data = new FormData();
		data.set("bootstrap", "invalid");
		expect(
			(await state.post("/_passkey/options/login", data, "", "192.0.2.2"))
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
		expect(await state.storage.size(db.ovr_sessions)).toBe(0);
	} finally {
		time.mockRestore();
	}
});

test("require returns the session, or redirects to the page and ends the request", async () => {
	const state = managed();
	const after = vi.fn();
	state.app.use(
		Route.get("/private", async (c) => {
			const session = await state.service.require(c);
			after();
			return c.json(session);
		}),
	);

	const anonymous = await state.app.fetch(origin + "/private");
	expect(anonymous.status).toBe(303);
	expect(anonymous.headers.get("location")).toBe("/login");
	expect(anonymous.headers.get("cache-control")).toBe("no-store");
	expect(after).not.toHaveBeenCalled();

	const login = await state.storage.post("/session", new FormData());
	const session: Auth.Session = await login.json();
	const signed = await state.app.fetch(origin + "/private", {
		headers: { cookie: login.headers.getSetCookie().at(-1)!.split(";")[0]! },
	});
	expect(signed.status).toBe(200);
	expect(await signed.json()).toEqual(session);
	expect(after).toHaveBeenCalledOnce();
});

test("auth requires a database at startup", () => {
	const storage = setup();
	expect(
		() =>
			new Auth({
				...storage.settings,
				// @ts-expect-error A shared database is required; the framework has no implicit storage.
				database: undefined,
			}),
	).toThrow("database");
});

test("auth rejects client limiter arrays at startup", () => {
	const storage = setup();
	for (const method of ["register", "login"]) {
		expect(() => managed(storage, { limits: { [method]: [] } })).toThrow(
			`limits.${method} must be rate limit options`,
		);
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
		const shared = [
			{ name: "network", prefix: 48, limit: 40 },
			{ name: "aggregate", key: () => "all", limit: 100 },
		];
		const limits = {
			guard: { name: "creation", key: () => "all", limit: 1000 },
			extra: shared,
		};
		const warm = managed(storage, { limits });
		const cold = managed(storage, { limits });
		shared.length = 0; // Extra policies are snapshotted too.
		const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
		try {
			for (const phase of ["options", "verify"]) {
				const path =
					phase === "options"
						? `/_passkey/options/${method}`
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
				for (const name of ["network", "aggregate"])
					expect(await spent(name, phase)).toBe(limit + 1);
				expect(await spent("creation", phase)).toBe(121); // Client-denied attempts still reach the guard, but skip extras.
			}
			expect(await storage.size(db.ovr_challenges)).toBe(0);
			expect(warm.create).not.toHaveBeenCalled();
			expect(cold.create).not.toHaveBeenCalled();
		} finally {
			clock.mockRestore();
		}
	},
);

test("a generous guard bounds client-record creation before the default and extra policies", async () => {
	const storage = setup();
	const check = vi.fn(() => "all");
	const state = managed(storage, {
		limits: {
			guard: { name: "creation", key: () => "all", limit: 3 },
			extra: [{ name: "aggregate", key: check, limit: 2 }],
		},
	});
	for (let i = 0; i < 10; i++) {
		const response = await state.post(
			"/_passkey/options/login",
			new FormData(),
			"",
			`192.0.2.${i + 1}`,
		);
		expect(response.status).toBe(i < 2 ? 400 : 429);
	}
	// one client bucket for each of the three admitted addresses
	expect(
		(await rows(db.ovr_limits)).filter(
			(bucket) => JSON.parse(bucket.key)[0] === "auth:login:" + origin,
		),
	).toHaveLength(3);
	expect(check).toHaveBeenCalledTimes(3);
	expect(await storage.size(db.ovr_challenges)).toBe(0);
	const buckets = await rows(db.ovr_limits);
	expect((await state.post("/auth/logout", new FormData())).status).toBe(303);
	expect(await rows(db.ovr_limits)).toEqual(buckets);
});

test("a failed creation guard stops backend access and extra checks but leaves logout available", async () => {
	const storage = setup();
	const check = vi.fn(() => "all");
	const state = managed(storage, {
		limits: {
			guard: {
				key: () => {
					throw new Error("private creation guard failure");
				},
			},
			extra: [{ key: check }],
		},
	});
	const response = await state.post("/_passkey/options/login", new FormData());
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private creation");
	expect(state.error).toHaveBeenCalledOnce();
	expect(await storage.size(db.ovr_limits)).toBe(0);
	expect(check).not.toHaveBeenCalled();
	expect(await storage.size(db.ovr_challenges)).toBe(0);
	expect((await state.post("/auth/logout", new FormData())).status).toBe(303);
});

test("optional guard and extra policies are validated at startup", () => {
	const storage = setup();
	expect(() =>
		// @ts-expect-error Auth creates its limiters, so a Limiter is rejected.
		managed(storage, { limits: { guard: new Limiter({ database: db }) } }),
	).toThrow("limits.guard must be rate limit options");
	expect(() =>
		// @ts-expect-error Runtime configuration must also reject non-object extra entries.
		managed(storage, { limits: { extra: [null] } }),
	).toThrow("limits.extra");
	expect(() =>
		managed(storage, { limits: { guard: {}, extra: [{}] } }),
	).not.toThrow();
	expect(() =>
		managed(storage, { limits: { extra: Array<Auth.Limit>(1) } }),
	).toThrow("limits.extra");
	// invalid policies are rejected by the Limiter Auth creates
	expect(() => managed(storage, { limits: { login: { limit: 0 } } })).toThrow(
		"Invalid limiter",
	);
});

test("layered policies stop prefix sweeping across instances and share an aggregate ceiling", async () => {
	const storage = setup();
	const calls = vi.fn(() => "all");
	const stack = [
		{ name: "network", limit: 2, prefix: 48 },
		{ name: "aggregate", limit: 3, key: calls },
	];
	const limits = { extra: stack };
	const first = managed(storage, { limits });
	const second = managed(storage, { limits });
	stack.length = 0; // The configured services own snapshots, not the caller's mutable array.
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
	expect(await storage.size(db.ovr_challenges)).toBe(3);
	expect(first.create).not.toHaveBeenCalled();
	expect(second.create).not.toHaveBeenCalled();
	expect((await first.post("/auth/logout", new FormData())).status).toBe(303);
});

test("a failing layer prevents challenge writes and preserves generic errors", async () => {
	const storage = setup();
	const check = vi.fn(() => "all");
	const state = managed(storage, {
		limits: {
			extra: [
				{
					key: () => {
						throw new Error("private backend failure");
					},
				},
				{ name: "later", key: check },
			],
		},
	});
	const response = await state.post("/_passkey/options/login", new FormData());
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private backend");
	expect(state.error).toHaveBeenCalledOnce();
	expect(check).not.toHaveBeenCalled();
	expect(await storage.size(db.ovr_challenges)).toBe(0);
});

test("limiter errors cannot prevent logout", async () => {
	const check = vi
		.spyOn(Limiter.prototype, "check")
		.mockRejectedValue(new Error("limiter unavailable"));
	const state = managed(setup());
	expect((await state.post("/auth/logout", new FormData())).status).toBe(303);
	expect(check).not.toHaveBeenCalled();
});

test("auth fails closed without trusted peer information and ignores spoofed IP headers", async () => {
	const state = managed();
	const set = vi.spyOn(state.storage.options.challenges, "set");
	const response = await state.app.fetch(origin + "/_passkey/options/login", {
		method: "POST",
		headers: {
			origin,
			"x-forwarded-for": "192.0.2.1",
			"cf-connecting-ip": "192.0.2.1",
		},
		body: new FormData(),
	});
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
	const check = vi.spyOn(Limiter.prototype, "check");
	const state = managed(setup());
	const set = vi.spyOn(state.storage.options.challenges, "set");
	for (const path of [
		"/auth/register",
		"/auth/login",
		"/auth/logout",
		"/_passkey/options/register",
		"/_passkey/options/login",
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
				await state.app.fetch("https://wrong.example/_passkey/client.js", {
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
	expect(await state.storage.size(db.ovr_sessions)).toBe(1);
});

test("configured options reject substituted operations and oversized bodies before storage", async () => {
	const state = managed();
	const start = await state.start("register");
	const set = vi.spyOn(state.storage.options.challenges, "set");
	const data = new FormData();
	data.set("bootstrap", start.bootstrap);
	const switched = await state.post(
		"/_passkey/options/login",
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
	expect(failure.headers.get("location")).toBe(origin + "/login?_auth=login");
	expect(await storage.size(db.ovr_sessions)).toBe(0);
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
	expect((await storage.record(id))?.counter).toBe(0);
	expect(await storage.size(db.ovr_sessions)).toBe(1);
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
	expect(failed.headers.get("location")).toBe(origin + "/login?_auth=register");
	expect(failed.headers.getSetCookie()).toHaveLength(0);
	expect(await state.storage.size(db.ovr_credentials)).toBe(1);
	expect(await state.storage.size(db.ovr_sessions)).toBe(0);
	const page = await state.app.fetch(failed.headers.get("location")!);
	expect(await page.text()).toContain("If you already registered, sign in");
	const login = await state.start("login", start.cookie);
	const result = await state.submit(
		login,
		await assertion(login.options.challenge, keys, {
			handle: (await state.storage.record(id))!.user,
		}),
		"/auth/login",
	);
	expect(result.headers.get("location")).toBe("/account");
	expect(state.create).toHaveBeenCalledOnce();
	expect(await state.storage.size(db.ovr_sessions)).toBe(1);
});

test.each(["register", "login"] as const)(
	"a denied final %s submit redirects to a recoverable form before verification",
	async (method) => {
		const retry = new Date(Date.now() + 45000);
		const check = vi
			.spyOn(Limiter.prototype, "check")
			.mockImplementation(async (_c, phase) =>
				phase === "options" ? true : retry,
			);
		const state = managed(setup());
		const start = await state.start(method);
		const take = vi.spyOn(state.storage.options.challenges, "take");
		const response = await state.submit(start, {}, `/auth/${method}`);
		expect(response.status).toBe(303);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const location = new URL(response.headers.get("location")!);
		expect(location.pathname).toBe("/login");
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
		expect(await state.storage.size(db.ovr_sessions)).toBe(0);
	},
);

test("a successful ceremony makes two separately admitted requests", async () => {
	const check = vi.spyOn(Limiter.prototype, "check");
	const state = managed(setup());
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
			vi.spyOn(Limiter.prototype, "check").mockResolvedValue(
				new Date(now + value),
			);
			const state = managed(setup());
			const response = await state.post(
				"/_passkey/options/login",
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
			const check = vi
				.spyOn(Limiter.prototype, "check")
				.mockResolvedValue(new Date(now + 86400000));
			const state = managed(setup());
			const response = await state.post(`/auth/${method}`, new FormData());
			expect(response.status).toBe(303);
			const location = new URL(response.headers.get("location")!);
			expect(location.searchParams.get("_retry")).toBe(String(now + 3600000));
			time.mockReturnValue(now + 3600000);
			const data = new FormData();
			data.set("email", "user@example.com");
			data.set("bootstrap", "invalid");
			const denied = await state.post(`/_passkey/options/${method}`, data);
			expect(denied.status).toBe(429);
			expect(denied.headers.get("retry-after")).toBe("3600");
			expect(check).toHaveBeenCalledTimes(2);
			expect(state.create).not.toHaveBeenCalled();
			expect(await state.storage.size(db.ovr_challenges)).toBe(0);
		} finally {
			time.mockRestore();
		}
	},
);

test("browser assets revalidate with an ETag instead of downloading unchanged code", async () => {
	const state = managed();
	const first = await state.app.fetch(origin + "/_passkey/client.js");
	const etag = first.headers.get("etag")!;
	expect(etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
	for (const value of [etag, etag.slice(2), `"other", ${etag}`, "*"]) {
		const cached = await state.app.fetch(origin + "/_passkey/client.js", {
			headers: { "if-none-match": value },
		});
		expect(cached.status).toBe(304);
		expect(await cached.text()).toBe("");
	}
	expect(
		(
			await state.app.fetch(origin + "/_passkey/client.js", {
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

test("the database retains the built-in auth policies across service instances", async () => {
	const first = managed();
	const second = managed(first.storage);
	const start = await first.start("register");
	const data = new FormData();
	data.set("email", "user@example.com");
	data.set("bootstrap", start.bootstrap);
	// five registration options in ten minutes, shared by both instances
	for (let i = 0; i < 4; i++)
		expect((await second.post(start.endpoint, data, start.cookie)).status).toBe(
			200,
		);
	expect((await second.post(start.endpoint, data, start.cookie)).status).toBe(
		429,
	);
	const response = await second.submit(
		start,
		await registration(start.options.challenge, await pair()),
	);
	expect(response.headers.get("location")).toBe("/account");
	// verification has its own bucket
	expect(
		(await rows(db.ovr_limits)).map((bucket) =>
			JSON.parse(bucket.key).slice(0, 4),
		),
	).toEqual(
		expect.arrayContaining([
			["auth:register:" + origin, 5, 600000, "options"],
			["auth:register:" + origin, 5, 600000, "verify"],
		]),
	);
});

test.each([undefined, "https://foreign.example"])(
	"generated auth routes reject cross-site posts independently of App CSRF: %s",
	async (foreign) => {
		const state = managed();
		const response = await state.storage.post("/session", new FormData());
		const session: Auth.Session = await response.json();
		const cookie = response.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const app = new App({ csrf: false, auth: state.service });
		const remove = vi.spyOn(state.storage.options.sessions, "delete");
		const consume = vi.spyOn(state.storage.options.challenges, "set");
		for (const path of [
			"/auth/logout",
			"/auth/register",
			"/auth/login",
			"/_passkey/options/register",
			"/_passkey/options/login",
		]) {
			const headers = new Headers({ cookie, "sec-fetch-site": "cross-site" });
			if (foreign) headers.set("origin", foreign);
			const result = await app.fetch(origin + path, {
				method: "POST",
				headers,
				ip: "192.0.2.1",
				body: new FormData(),
			});
			expect(result.status).toBe(
				path === "/auth/register" || path === "/auth/login" ? 303 : 403,
			);
			if (result.status === 303)
				expect(result.headers.get("location")).toContain("?_auth=");
			expect(result.headers.getSetCookie()).toHaveLength(0);
			expect(await state.storage.session(session.id)).toEqual(session);
		}
		expect(remove).not.toHaveBeenCalled();
		expect(consume).not.toHaveBeenCalled();
	},
);

test.each(["origin", "sec-fetch-site"])(
	"generated auth routes accept same-origin %s with App CSRF disabled",
	async (header) => {
		const state = managed();
		const start = await state.start("register");
		const app = new App({ csrf: false, auth: state.service });
		const headers = {
			cookie: start.cookie,
			[header]: header === "origin" ? origin : "same-origin",
		};
		const data = new FormData();
		data.set("bootstrap", start.bootstrap);
		data.set("email", "user@example.com");
		expect(
			(
				await app.fetch(origin + start.endpoint, {
					method: "POST",
					headers,
					body: data,
					ip: "192.0.2.1",
				})
			).status,
		).toBe(200);
		const logged = await state.storage.post("/session", new FormData());
		const session: Auth.Session = await logged.json();
		const result = await app.fetch(origin + "/auth/logout", {
			method: "POST",
			headers: {
				...headers,
				cookie: logged.headers.getSetCookie().at(-1)!.split(";")[0]!,
			},
		});
		expect(result.status).toBe(303);
		expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(await state.storage.session(session.id)).toBeUndefined();
	},
);

test("default Register and Login render together without duplicate IDs", async () => {
	const state = managed();
	state.app.use(
		Route.get("/forms", (c) => {
			const { Register, Login } = state.service.forms(c);
			return [jsx(Register, {}), jsx(Login, {})];
		}),
	);
	const html = await (await state.app.fetch(origin + "/forms")).text();
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
	expect(ids.length).toBe(3);
	expect(new Set(ids).size).toBe(ids.length);
	const hidden = [...html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)];
	expect(hidden).toHaveLength(4);
	for (const [input] of hidden) expect(input).not.toMatch(/\bid=/);
	expect(html).toContain('src="/_passkey/client.js"');
	expect(html).toContain("<button>Create account</button>");
	expect(html).toContain("<button>Log in</button>");
	expect(html).not.toContain("data-ovr");
});

test("registration rejects changed application fields before account or session creation", async () => {
	const state = managed();
	const start = await state.start("register");
	expect((await state.storage.challenge(start.ceremony))?.fields).toBe(
		await Passkey.fields({ email: "user@example.com" }),
	);
	const data = new FormData();
	data.set("email", "changed@example.com");
	data.set("ceremony", start.ceremony);
	data.set(
		"credential",
		JSON.stringify(await registration(start.options.challenge, await pair())),
	);
	const result = await state.post("/auth/register", data, start.cookie);
	expect(result.headers.get("location")).toBe(origin + "/login?_auth=register");
	expect(result.headers.getSetCookie()).toHaveLength(0);
	expect(state.create).not.toHaveBeenCalled();
	expect(await state.storage.size(db.ovr_sessions)).toBe(0);
	expect(await state.storage.challenge(start.ceremony)).toBeUndefined();
});

test("registration field digests ignore object order and preserve array order and values", async () => {
	expect(await Passkey.fields({ b: { y: 2, x: 1 }, a: [1, 2] })).toBe(
		await Passkey.fields({ a: [1, 2], b: { x: 1, y: 2 } }),
	);
	expect(await Passkey.fields({ a: [1, 2] })).not.toBe(
		await Passkey.fields({ a: [2, 1] }),
	);
	expect(await Passkey.fields({ a: "1" })).not.toBe(
		await Passkey.fields({ a: 1 }),
	);
});

test("revoking an unrelated session leaves an invalid incoming cookie alone", async () => {
	const state = setup();
	const remove = vi.spyOn(state.options.sessions, "delete");
	const cookie = "__Host-auth-session=invalid";
	const result = await state.post("/revoke/other", new FormData(), cookie);
	expect(result.status).toBe(200);
	expect(remove).toHaveBeenCalledExactlyOnceWith("other");
	expect(result.headers.getSetCookie()).toHaveLength(0);
	const read = await state.app.fetch(origin + "/session", {
		headers: { cookie },
	});
	expect(await read.json()).toBeNull();
	expect(read.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("invalid registration options spend only the guard budget before a valid signup", async () => {
	const storage = setup();
	const order: string[] = [];
	const key = (name: string) => () => (order.push(name), "all");
	const state = managed(storage, {
		limits: {
			guard: { name: "guard", limit: 20, key: key("guard") },
			extra: [{ name: "extra", limit: 10, key: key("extra") }],
		},
	});
	const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
	const start = await state.start("register");
	const register = "auth:register:" + origin;
	order.length = 0;
	for (let i = 0; i < 8; i++) {
		const data = new FormData();
		data.set("bootstrap", start.bootstrap);
		data.set("email", "typo");
		expect((await state.post(start.endpoint, data, start.cookie)).status).toBe(
			422,
		);
	}
	expect(order).toEqual(Array(8).fill("guard"));
	expect(await spent(register, "options")).toBe(1);
	const data = new FormData();
	data.set("bootstrap", start.bootstrap);
	data.set("email", "user@example.com");
	expect((await state.post(start.endpoint, data, start.cookie)).status).toBe(
		200,
	);
	// the client policy runs between the guard and the extra policy
	expect(order.slice(-2)).toEqual(["guard", "extra"]);
	expect(await spent(register, "options")).toBe(2);
	clock.mockRestore();
});

test("rotating secrets preserves sessions and open forms across instances", async () => {
	const old = managed();
	const rotated = managed(old.storage, {
		secret: [
			"new-signing-secret-with-at-least-32-bytes",
			"test-secret-with-at-least-32-bytes",
		],
	});
	const start = await old.start("register", "", rotated.post);
	const result = await rotated.submit(
		start,
		await registration(start.options.challenge, await pair()),
	);
	expect(result.headers.get("location")).toBe("/account");
	const logged = await old.storage.post("/session", new FormData());
	const cookie = logged.headers.getSetCookie().at(-1)!.split(";")[0]!;
	expect(
		await (
			await rotated.app.fetch(origin + "/whoami", { headers: { cookie } })
		).json(),
	).not.toBeNull();
	const removed = managed(old.storage, {
		secret: "new-signing-secret-with-at-least-32-bytes",
	});
	expect(
		await (
			await removed.app.fetch(origin + "/whoami", { headers: { cookie } })
		).json(),
	).toBeNull();
});

test("every rotation secret is validated and the configured list is snapshotted", async () => {
	const state = setup();
	expect(
		() =>
			new Auth({
				...state.settings,
				secret: ["test-secret-with-at-least-32-bytes", "short"],
			}),
	).toThrow("at least 32 bytes");
	const secrets: [string, ...string[]] = ["test-secret-with-at-least-32-bytes"];
	const auth = new Auth({ ...state.settings, secret: secrets });
	secrets[0] = "replacement-secret-with-at-least-32-bytes";
	const app = new App().use(
		Route.get("/session", async (c) => c.json(await auth.session(c))),
	);
	const login = await state.post("/session", new FormData());
	expect(
		await (
			await app.fetch(origin + "/session", {
				headers: {
					cookie: login.headers.getSetCookie().at(-1)!.split(";")[0]!,
				},
			})
		).json(),
	).not.toBeNull();
});

test.each(["expired", "browser"])(
	"configured options return a reload response for a %s bootstrap without writing a challenge",
	async (failure) => {
		const state = managed();
		const start = await state.start("register");
		const set = vi.spyOn(state.storage.options.challenges, "set");
		const time = vi.spyOn(Date, "now");
		if (failure === "expired") time.mockReturnValue(Date.now() + Time.hour + 1);
		try {
			const data = new FormData();
			data.set("bootstrap", start.bootstrap);
			data.set("email", "user@example.com");
			const response = await state.post(
				start.endpoint,
				data,
				failure === "browser" ? "__Host-auth-browser=other" : start.cookie,
			);
			expect(response.status).toBe(410);
			expect(await response.text()).toBe(
				"This page has expired. Reload and try again.",
			);
			expect(response.headers.getSetCookie()).toHaveLength(0);
			expect(set).not.toHaveBeenCalled();
			expect(state.create).not.toHaveBeenCalled();
		} finally {
			time.mockRestore();
		}
	},
);

test("registration guard admission precedes parsing and rejects oversized bodies without client tokens", async () => {
	const storage = setup();
	const check = vi.fn(() => "all");
	const state = managed(storage, {
		limits: { guard: { name: "guard", limit: 1, key: check } },
	});
	const data = new FormData();
	data.set("email", "x".repeat(129 * 1024));
	data.set("bootstrap", "invalid");
	const response = await state.post("/_passkey/options/register", data);
	expect(response.status).toBe(400);
	// only the guard, the client policy runs after parsing
	expect(
		(await rows(db.ovr_limits)).map((bucket) => JSON.parse(bucket.key)[0]),
	).toEqual(["guard"]);
	// the exhausted guard denies before the oversized body is read
	expect((await state.post("/_passkey/options/register", data)).status).toBe(
		429,
	);
	expect(check).toHaveBeenCalledTimes(2);
	expect(await storage.size(db.ovr_challenges)).toBe(0);
});

/** Checksums of the shipped migrations: never update them, add a new version instead. */
const checksums = {
	auth: "a4d5f0d1412b317cec0679a8b5400c5114354b6f3bf464630991a92e6bfc79e4",
	limiter: "4cd3ada37ed2f7208ddbf1728780c485de42a5424f126772582c165e54022f1a",
};

describe("migration SQL", () => {
	test("creates the tables Auth uses", async () => {
		expect(await db.check()).toEqual([]);
	});

	// an applied migration's checksum must never change, new SQL ships as a new version
	test.each([
		["Auth.sql[1]", Auth.sql[1], checksums.auth],
		["Limiter.sql[1]", Limiter.sql[1], checksums.limiter],
	])("%s never changes", async (_, sql, checksum) => {
		expect(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql)),
			).toHex(),
		).toBe(checksum);
	});
});

describe("Postgres storage", () => {
	const expiration = Date.now() + Time.hour;
	const challenge = (browser: string): Storage.Challenge => ({
		challenge: "c",
		browser,
		method: "login",
		action: "/auth/login",
		origin,
		expiration,
	});

	test("bounds outstanding challenges for each browser", async () => {
		for (let i = 0; i < 10; i++)
			expect(await storage.challenges.set(`a${i}`, challenge("a"))).toBe(true);
		expect(await storage.challenges.set("a10", challenge("a"))).toBe(false);
		expect(await storage.challenges.set("b0", challenge("b"))).toBe(true);
		expect(await inspect.size(db.ovr_challenges)).toBe(11);
	});

	test("takes a challenge once, even concurrently, preserving optional fields", async () => {
		await storage.challenges.set("one", {
			...challenge("a"),
			user: "u",
			fields: "digest",
		});
		await storage.challenges.set("two", challenge("a"));
		const taken = await Promise.all([
			storage.challenges.take("one"),
			storage.challenges.take("one"),
		]);
		expect(taken.filter(Boolean)).toEqual([
			{ ...challenge("a"), user: "u", fields: "digest" },
		]);
		expect(await storage.challenges.take("two")).toEqual(challenge("a"));
	});

	test("updates a credential only from its current snapshot", async () => {
		const credential: Auth.Credential = {
			id: "credential",
			user: "u",
			publicKey: "key",
			counter: 1,
			eligible: true,
			backedUp: false,
		};
		await db.sql`INSERT INTO ${db.ovr_credentials} ${db.sql.values(db.ovr_credentials, credential)}`;
		const next = { ...credential, counter: 2, backedUp: true };
		expect(await storage.credentials.update(next, credential)).toBe(true);
		// the stored counter has moved on, so the stale snapshot loses
		expect(
			await storage.credentials.update({ ...next, counter: 3 }, credential),
		).toBe(false);
		expect(await storage.credentials.get("credential")).toEqual(next);
		await db.sql`DELETE FROM ${db.ovr_credentials}`;
		expect(await storage.credentials.update(next, next)).toBe(false);
		expect(await inspect.size(db.ovr_credentials)).toBe(0);
	});

	test("registers the account and credential together or not at all", async () => {
		const credential: Auth.Credential = {
			id: "credential",
			user: "u",
			publicKey: "key",
			counter: 0,
			eligible: false,
			backedUp: false,
		};
		const create = async (t: Database.Transaction, user: string) => {
			await t.sql`INSERT INTO ${users} ${t.sql.values(users, { id: user, email: "a@example.com" })}`;
		};
		await storage.register(create, credential);
		// a duplicate credential rolls back the second account
		await expect(
			storage.register(create, { ...credential, user: "v" }),
		).rejects.toThrow();
		await expect(
			storage.register(
				async () => {
					throw new Error("account failed");
				},
				{ ...credential, id: "other" },
			),
		).rejects.toThrow("account failed");
		expect(await rows(users)).toEqual([{ id: "u", email: "a@example.com" }]);
		expect(await rows(db.ovr_credentials)).toEqual([credential]);
	});

	test("prunes expired sessions and challenges", async () => {
		const now = Date.now();
		await storage.sessions.set("old", {
			id: "old",
			user: "u",
			expiration: now + 1,
		});
		await storage.challenges.set("old", {
			...challenge("a"),
			expiration: now + 1,
		});
		vi.spyOn(Date, "now").mockReturnValue(now + 2 * Time.minute);
		expect(await storage.sessions.get("old")).toBeUndefined();
		await storage.sessions.set("new", {
			id: "new",
			user: "u",
			expiration: now + Time.hour,
		});
		expect((await rows(db.ovr_sessions)).map((session) => session.id)).toEqual([
			"new",
		]);
		expect(await inspect.size(db.ovr_challenges)).toBe(0);
	});
});
