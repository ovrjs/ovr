import { App, mount, agents as signin } from "../app/index.js";
import { Database, owned } from "../database/index.js";
import { Field } from "../form/index.js";
import { jsx } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import { Mcp } from "../mcp/index.js";
import type { Middleware } from "../middleware/index.js";
import { Route } from "../route/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Codec, Time } from "../util/index.js";
import { Auth } from "./index.js";
import { Metadata } from "./metadata.js";
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
const users = new Table("users", { id: Schema.string(), email: Field.email() });
/** The PGlite engine as a pool, for databases over it */
const pool: Database.Pool = {
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
};
const db = new Database(pool, [users, ...Auth.tables]);
/** The app's own migration, after Auth's */
const own = {
	id: "0001_users",
	sql: "CREATE TABLE users (id text PRIMARY KEY, email text NOT NULL)",
};
// the shipped migrations, so these tests cover them too
const applied = await db.migrate([own]);
const storage = Storage.of(db);

beforeEach(() =>
	engine.exec(
		"TRUNCATE users, auth_credentials, auth_sessions, auth_challenges, rate_limits, auth_tokens",
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
	/** The stored session as `c.session()` returns it, without its start time. */
	session: async (id: string) => {
		const row = (await rows(db.auth_sessions)).find(
			(session) => session.id === id,
		);
		if (!row) return;
		const { started: _, ...session } = row;
		return session;
	},
	challenge: async (id: string) =>
		(await rows(db.auth_challenges)).find((challenge) => challenge.id === id),
	/** Change a stored challenge, as another instance or an attacker could. */
	edit: async (
		id: string,
		values: Partial<Schema.Infer<typeof db.auth_challenges>>,
	) => {
		await db.sql`UPDATE ${db.auth_challenges} SET ${db.sql.set(db.auth_challenges, values)} WHERE id = ${id}`;
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
	const settings: Auth.Options<typeof users> = {
		secret: options.secret,
		origin: options.origin,
		...(options.idle === undefined ? {} : { idle: options.idle }),
		...(options.lifetime === undefined ? {} : { lifetime: options.lifetime }),
		database: db,
		users,
	};
	const auth = new Auth(settings);
	const app = new App();
	// reads sessions for c.session(), as app.use(auth) does
	app.use((auth[mount]() as [Middleware])[0]);
	// Internal protocol tests compose their own routes; applications use new Auth().
	const issue = (method: "register" | "login") =>
		Route.post(method === "register" ? endpoint : `${endpoint}/login`)
			.fields({ bootstrap: Field.text() })
			.use(async (c) => {
				const input = await c.data({ payload: 128 * 1024 });
				if (input.issues) throw input;
				await Passkey.issue(
					c,
					new State(c, options),
					input.data.bootstrap,
					() => "User",
					{ method, action: `/${method}` },
				);
			});
	app.use(issue("register"), issue("login"), Passkey.client);
	const register = Route.post("/register")
		.fields({ email: Field.email() })
		.use(async (c) => {
			const input = await c.data();
			if (input.issues) throw input;
			const credential = await new Passkey(c, new State(c, options)).register();
			await db.sql`INSERT INTO ${db.auth_credentials} ${db.sql.values(db.auth_credentials, credential)}`;
			c.json(credential);
		});
	const login = Route.post("/login")
		.fields({})
		.use(async (c) =>
			c.json(await new Passkey(c, new State(c, options)).login(credentials)),
		);
	Passkey.prepare(register);
	Passkey.prepare(login);
	app.use(
		register,
		login,
		Route.get("/register-page").use((c) =>
			jsx(
				new Passkey(c, new State(c, options)).form(register, "register", {
					endpoint,
				}),
				{},
			),
		),
		Route.get("/login-page").use((c) =>
			jsx(
				new Passkey(c, new State(c, options)).form(login, "login", {
					endpoint: `${endpoint}/login`,
				}),
				{},
			),
		),
		Route.get("/session").use(async (c) => c.json(await c.session())),
		Route.post("/session").use(async (c) => c.json(await auth.login(c, user))),
		Route.post("/logout").use(async (c) => c.json(await auth.logout(c))),
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
		expect(await state.size(db.auth_challenges)).toBe(0);
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
		expect(await state.size(db.auth_challenges)).toBe(0);
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
		expect(await state.size(db.auth_credentials)).toBe(0);
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

	test("does not prepare forms for a different request host", async () => {
		const state = setup();
		await expect(
			state.app.fetch("https://evil.example/register-page"),
		).rejects.toThrow("Invalid origin");
	});
});

describe("revocable sessions", () => {
	test("uses the default idle timeout and lifetime when they are explicitly undefined", async () => {
		// @ts-expect-error JavaScript callers can explicitly pass undefined.
		const state = setup({ idle: undefined, lifetime: undefined });
		const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
		try {
			const response = await state.post("/session", new FormData());
			const session: Auth.Session = await response.json();
			const cookie = response.headers.getSetCookie().at(-1)!;
			expect(session.expiration).toBe(Date.now() + Time.week);
			expect((await state.session(session.id))?.expiration).toBe(
				Date.now() + Time.week,
			);
			// the cookie lasts the lifetime, renewals only change the record
			expect(cookie).toContain(`Max-Age=${(30 * Time.day) / Time.second}`);
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
		expect(await state.size(db.auth_sessions)).toBe(2);
		const cookies = [first, second].map(
			(response) => response.headers.getSetCookie().at(-1)!.split(";")[0]!,
		);
		const get = vi.spyOn(state.options.sessions, "get");
		state.app.use(
			Route.get("/cached").use(async (c) => {
				const first = c.session();
				expect(c.session()).toBe(first);
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

	test("rejects a stored session whose ID differs from the signed cookie", async () => {
		const state = setup();
		const login = await state.post("/session", new FormData());
		const session: Auth.Session = await login.json();
		const get = vi
			.spyOn(state.options.sessions, "get")
			.mockReturnValueOnce({
				...session,
				id: session.user,
				started: Date.now(),
			});
		const response = await state.app.fetch(origin + "/session", {
			headers: { cookie: login.headers.getSetCookie().at(-1)!.split(";")[0]! },
		});
		expect(get).toHaveBeenCalledWith(session.id);
		expect(await response.json()).toBeNull();
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
	});

	test.each(["", " ", "x".repeat(1025), "é".repeat(513)])(
		"rejects invalid session user IDs before persistence: %s",
		async (id) => {
			const state = setup();
			const get = vi.spyOn(state.options.sessions, "get");
			const set = vi.spyOn(state.options.sessions, "set");
			state.app.use(
				Route.get("/invalid-user").use(async (c) => {
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
		expect(await state.size(db.auth_sessions)).toBe(0);
	});

	test("rotates sessions, and deleting a session's row signs it out", async () => {
		const state = setup();
		const first = await state.post("/session", new FormData());
		const cookie = first.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const second = await state.post("/session", new FormData(), cookie);
		const session: Auth.Session = await second.json();
		const current = second.headers.getSetCookie().at(-1)!.split(";")[0]!;
		expect(await state.size(db.auth_sessions)).toBe(1);
		expect(
			await (
				await state.app.fetch(origin + "/session", { headers: { cookie } })
			).json(),
		).toBeNull();
		await db.sql`DELETE FROM ${db.auth_sessions} WHERE ${db.auth_sessions.columns.id} = ${session.id}`;
		const read = await state.app.fetch(origin + "/session", {
			headers: { cookie: current },
		});
		expect(await read.json()).toBeNull();
		expect(read.headers.get("set-cookie")).toContain("Max-Age=0");
	});

	test("renews sessions while used, at most once a day, until their lifetime", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const state = setup({ idle: 2 * Time.day, lifetime: 5 * Time.day });
		const renew = vi.spyOn(state.options.sessions, "renew");
		const login = await state.post("/session", new FormData());
		const { id }: Auth.Session = await login.json();
		const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const read = async () =>
			(await (
				await state.app.fetch(origin + "/session", { headers: { cookie } })
			).json()) as Auth.Session | null;
		try {
			expect((await read())?.expiration).toBe(now + 2 * Time.day);
			// under a day since the last renewal, nothing is written
			clock.mockReturnValue(now + 12 * Time.hour);
			expect((await read())?.expiration).toBe(now + 2 * Time.day);
			expect(renew).not.toHaveBeenCalled();
			// a day later, it renews for another idle timeout
			clock.mockReturnValue(now + 1.5 * Time.day);
			expect((await read())?.expiration).toBe(now + 3.5 * Time.day);
			expect(renew).toHaveBeenCalledOnce();
			// the stored record moves too, so other instances see it
			expect((await state.session(id))?.expiration).toBe(now + 3.5 * Time.day);
			// used regularly, it still ends at its lifetime
			clock.mockReturnValue(now + 3 * Time.day);
			expect((await read())?.expiration).toBe(now + 5 * Time.day);
			clock.mockReturnValue(now + 4.5 * Time.day);
			expect((await read())?.expiration).toBe(now + 5 * Time.day);
			clock.mockReturnValue(now + 5 * Time.day);
			expect(await read()).toBeNull();
		} finally {
			clock.mockRestore();
		}
	});

	test("expires sessions left unused for the idle timeout and propagates storage errors", async () => {
		const state = setup({ idle: Time.second });
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
	test("keeps internals private and exports public context and persistence types", async () => {
		const api = await import("../index.js");
		// Auth answers its issues itself, so they are not part of the API
		expect(api.Auth).not.toHaveProperty("Issue");
		expect(api).not.toHaveProperty("AuthIssue");
		const { auth } = setup();
		for (const name of ["routes", "bearer", "origin"])
			expect(name in auth).toBe(false);
		expectTypeOf<keyof Auth.Session>().toEqualTypeOf<
			"id" | "user" | "expiration"
		>();
		expectTypeOf<keyof Auth.Credential>().toEqualTypeOf<
			"id" | "user" | "publicKey" | "counter" | "eligible" | "backedUp"
		>();
		expectTypeOf(Auth.tables.map((table) => table.name)).toEqualTypeOf<
			(
				| "auth_credentials"
				| "auth_sessions"
				| "auth_challenges"
				| "rate_limits"
				| "auth_tokens"
			)[]
		>();
		if (false) {
			// @ts-expect-error The promise helper is internal.
			const result: Auth.Result<string> = "";
			void result;
		}
	});

	test("retains typed route parameters and safely serializes script arguments", async () => {
		const state = setup();
		const route = Route.post("/accounts/:account/passkeys")
			.fields({ email: Field.email() })
			.use((c) => c.text(c.params.account));
		Passkey.prepare(route);
		state.app.use(
			route,
			Route.get("/typed").use((c) => {
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
		expect(await state.size(db.auth_credentials)).toBe(0);
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
		expect(await state.size(db.auth_credentials)).toBe(0);
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
	extra: Partial<Auth.Options<typeof users>> = {},
) {
	/** @returns The accounts registration created */
	const created = () => rows(users);
	const service = new Auth({
		...storage.settings,
		redirect: "/account",
		...extra,
	});
	const app = new App().use(service);
	app.use(
		Route.get("/login").use((c) => {
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
		Route.get("/whoami").use(async (c) => c.json(await c.session())),
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
	return { app, service, storage, created, post, start, submit };
}

/** The key a rate limit bucket is stored under, a hash of its policy, scope, and identity */
const bucket = async (
	name: string,
	limit: number,
	interval: number,
	scope: string,
	identity = "192.0.2.1",
) =>
	Codec.Base64Url.encode(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				Codec.encode(JSON.stringify([name, limit, interval, scope, identity])),
			),
		),
	);

/** Tokens a policy has spent from one client's bucket; freeze the clock so none refill. */
const spent = async (...policy: Parameters<typeof bucket>) => {
	const key = await bucket(...policy);
	const found = (await rows(db.rate_limits)).find((row) => row.key === key);
	return found ? policy[1] - found.tokens : 0;
};

describe("configured passkey callbacks", () => {
	test("invalid UTF-8 in clientDataJSON is an authentication failure, not an internal error", async () => {
		const state = managed();
		const start = await state.start("register");
		const credential = await registration(
			start.options.challenge,
			await pair(),
		);
		credential.response.clientDataJSON = Codec.Base64Url.encode(
			Uint8Array.of(0xff),
		);

		const response = await state.submit(start, credential);
		expect(response.status).toBe(303);
		expect(
			new URL(response.headers.get("location")!).searchParams.get("_auth"),
		).toBe("register");
		expect(await state.created()).toEqual([]);
		expect(await rows(db.auth_credentials)).toEqual([]);
		expect(await rows(db.auth_sessions)).toEqual([]);
	});

	test("invalid UTF-8 in a multipart header is a client error on the passkey endpoint", async () => {
		const state = managed();
		const response = await state.app.fetch(origin + "/_passkey/options/login", {
			method: "POST",
			headers: {
				origin,
				"content-type": "multipart/form-data; boundary=invalid",
			},
			ip: "192.0.2.1",
			body: bytes(
				Codec.encode('--invalid\r\nContent-Disposition: form-data; name="'),
				Uint8Array.of(0xff),
				Codec.encode('"\r\n\r\nvalue\r\n--invalid--\r\n'),
			),
		});
		expect(response.status).toBe(400);
	});

	test("public signup cannot override a server-default role used by an admin edit form", async () => {
		const accounts = new Table(
			"signup_accounts",
			{
				id: Schema.string(),
				email: Field.email(),
				role: Field.select(["member", "admin"]),
			},
			{ default: ["role"] },
		);
		const database = new Database(
			{ query: run, connect: async () => ({ query: run, release() {} }) },
			[accounts, ...Auth.tables],
		);
		const auth = new Auth({ ...setup().settings, database, users: accounts });
		const app = new App().use(
			auth,
			Route.get("/signup").use((c) => {
				const { Register } = auth.forms(c);
				return Register({ children: Register.Field({ name: "email" }) });
			}),
		);
		const page = await app.fetch(origin + "/signup");
		const html = await page.text();
		const cookie = page.headers
			.getSetCookie()
			.map((v) => v.split(";")[0])
			.join("; ");
		expect(html).not.toContain('name="role"');
		const post = (path: string, body: FormData) =>
			app.fetch(origin + path, {
				method: "POST",
				headers: { origin, cookie },
				ip: "192.0.2.1",
				body,
			});
		await engine.exec(
			"CREATE TABLE signup_accounts (id text PRIMARY KEY, email text NOT NULL, role text NOT NULL DEFAULT 'member')",
		);
		try {
			const body = new FormData();
			body.set("email", "member@example.com");
			body.set("role", "admin");
			body.set(
				"bootstrap",
				/data-bootstrap="([^"]+)"/
					.exec(html)![1]!
					.replaceAll("&quot;", '"')
					.replaceAll("&amp;", "&"),
			);
			const start = await post("/_passkey/options/register", body);
			if (start.ok) {
				const { ceremony, options } = await start.json();
				body.delete("bootstrap");
				body.set("ceremony", ceremony);
				body.set(
					"credential",
					JSON.stringify(await registration(options.challenge, await pair())),
				);
				await post("/auth/register", body);
			}
			expect(
				await database.sql`SELECT id FROM signup_accounts WHERE role = 'admin'`,
			).toEqual([]);
		} finally {
			await engine.exec("DROP TABLE signup_accounts");
		}
	});
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
		expect(await cold.created()).toEqual([
			{ id: expect.any(String), email: "user@example.com" },
		]);
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
		expect(await warm.storage.size(db.auth_sessions)).toBe(1);
		expect(await warm.storage.session(session.id)).toBeUndefined();
		const current = logged.headers.getSetCookie().at(-1)!.split(";")[0]!;
		const logout = await cold.post("/auth/logout", new FormData(), current);
		expect(logout.headers.get("location")).toBe("/login");
		expect(await warm.storage.size(db.auth_sessions)).toBe(0);
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
			expect(await state.created()).toHaveLength(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("throws account persistence failures to the app without issuing a session", async () => {
		const state = managed();
		vi.spyOn(Storage.of(db), "register").mockRejectedValueOnce(
			new Error("private database details"),
		);
		const start = await state.start("register");
		await expect(
			state.submit(
				start,
				await registration(start.options.challenge, await pair()),
			),
		).rejects.toThrow("private database details");
		expect(await state.storage.size(db.auth_sessions)).toBe(0);
	});

	test("an account that already exists returns to the form", async () => {
		const state = managed();
		vi.spyOn(Storage.of(db), "register").mockRejectedValueOnce(
			Object.assign(new Error("duplicate key"), { code: "23505" }),
		);
		const start = await state.start("register");
		const result = await state.submit(
			start,
			await registration(start.options.challenge, await pair()),
		);
		expect(result.headers.get("location")).toBe(
			origin + "/login?_auth=register",
		);
		expect(result.headers.getSetCookie()).toHaveLength(0);
		const page = await state.app.fetch(result.headers.get("location")!);
		expect(await page.text()).toContain("If you already registered, sign in");
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

	test("rejects invalid pages at startup", () => {
		expect(() => managed(setup(), { page: "https://evil.example" })).toThrow(
			"local paths",
		);
		expect(() => managed(setup(), { page: "/auth/login" })).toThrow(
			"endpoints",
		);
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
		expect(await state.storage.size(db.auth_sessions)).toBe(0);
	} finally {
		time.mockRestore();
	}
});

test("a protected page checks the session and redirects when signed out", async () => {
	const state = managed();
	const after = vi.fn();
	state.app.use(
		Route.get("/private").use(async (c) => {
			const session = await c.session();
			if (!session) return c.redirect("/login", 303);
			after();
			return c.json(session);
		}),
	);

	const anonymous = await state.app.fetch(origin + "/private");
	expect(anonymous.status).toBe(303);
	expect(anonymous.headers.get("location")).toBe("/login");
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

test("auth requires a database", () => {
	const storage = setup();
	// type errors, never run
	void (() => {
		new Auth({
			...storage.settings,
			// @ts-expect-error A shared database is required; the framework has no implicit storage.
			database: undefined,
		});
	});
});

test("a failing limiter prevents challenge writes and throws to the app", async () => {
	const storage = setup();
	vi.spyOn(Limiter.prototype, "check").mockRejectedValue(
		new Error("private backend failure"),
	);
	const state = managed(storage);
	await expect(
		state.post("/_passkey/options/login", new FormData()),
	).rejects.toThrow("private backend failure");
	expect(await storage.size(db.auth_challenges)).toBe(0);
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
	await expect(
		state.app.fetch(origin + "/_passkey/options/login", {
			method: "POST",
			headers: {
				origin,
				"x-forwarded-for": "192.0.2.1",
				"cf-connecting-ip": "192.0.2.1",
			},
			body: new FormData(),
		}),
	).rejects.toThrow("trusted client IP");
	expect(set).not.toHaveBeenCalled();
});

test("nobody is signed in on another host, without reading storage", async () => {
	const state = managed();
	const get = vi.spyOn(state.storage.options.sessions, "get");
	const response = await state.app.fetch("https://wrong.example/whoami");
	expect(response.status).toBe(200);
	expect(await response.json()).toBeNull();
	expect(get).not.toHaveBeenCalled();
});

test("alternate hosts can serve health checks and redirects without using authentication", async () => {
	const state = managed();
	state.app.use(
		Route.get("/health").use((c) => c.text("ok")),
		Route.get("/canonical").use((c) => c.redirect(origin + "/", 308)),
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
	expect(await state.created()).toHaveLength(0);
});

test("reading a session enforces Auth's origin", async () => {
	const state = setup();
	const app = new App();
	app.use(
		(state.auth[mount]() as [Middleware])[0],
		Route.get("/private").use(async (c) => c.json(await c.session())),
	);
	const response = await app.fetch("https://wrong.example/private");
	expect(await response.json()).toBeNull();
	// signing in or out there throws, Auth's cookies and passkeys are bound to its origin
	const login = new App().use(
		(state.auth[mount]() as [Middleware])[0],
		Route.post("/login").use(async (c) =>
			c.json(await state.auth.login(c, "u")),
		),
	);
	await expect(
		login.fetch("https://wrong.example/login", { method: "POST" }),
	).rejects.toThrow("Auth serves");
});

test("configured logout throws storage failures without claiming success", async () => {
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
	await expect(
		state.post("/auth/logout", new FormData(), cookie),
	).rejects.toThrow("private revocation failure");
	expect(await state.storage.size(db.auth_sessions)).toBe(1);
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
	expect(await storage.size(db.auth_sessions)).toBe(0);
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
	expect(await storage.size(db.auth_sessions)).toBe(1);
});

test("account persistence may complete before session storage fails; normal login can recover", async () => {
	const state = managed();
	const keys = await pair();
	vi.spyOn(state.storage.options.sessions, "set").mockRejectedValueOnce(
		new Error("session unavailable"),
	);
	const start = await state.start("register");
	await expect(
		state.submit(start, await registration(start.options.challenge, keys)),
	).rejects.toThrow("session unavailable");
	expect(await state.storage.size(db.auth_credentials)).toBe(1);
	expect(await state.storage.size(db.auth_sessions)).toBe(0);
	const login = await state.start("login", start.cookie);
	const result = await state.submit(
		login,
		await assertion(login.options.challenge, keys, {
			handle: (await state.storage.record(id))!.user,
		}),
		"/auth/login",
	);
	expect(result.headers.get("location")).toBe("/account");
	expect(await state.created()).toHaveLength(1);
	expect(await state.storage.size(db.auth_sessions)).toBe(1);
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
		expect(await state.created()).toHaveLength(0);
		expect(await state.storage.size(db.auth_sessions)).toBe(0);
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
			const response = state.post("/_passkey/options/login", new FormData());
			expect((await response).status).toBe(429);
			expect((await response).headers.get("retry-after")).toBe(retry);
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
			expect(await state.created()).toHaveLength(0);
			expect(await state.storage.size(db.auth_challenges)).toBe(0);
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
		expect(await state.created()).toHaveLength(1);
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
	expect((await rows(db.rate_limits)).map((row) => row.key)).toEqual(
		expect.arrayContaining([
			await bucket("auth:register:" + origin, 5, 600000, "options"),
			await bucket("auth:register:" + origin, 5, 600000, "verify"),
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
		const app = new App({ csrf: false }).use(state.service);
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
		const app = new App({ csrf: false }).use(state.service);
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
		Route.get("/forms").use((c) => {
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
	expect(await state.created()).toHaveLength(0);
	expect(await state.storage.size(db.auth_sessions)).toBe(0);
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

test("invalid registration options do not spend the signup budget", async () => {
	const storage = setup();
	const state = managed(storage);
	const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
	const start = await state.start("register");
	const register = "auth:register:" + origin;
	for (let i = 0; i < 8; i++) {
		const data = new FormData();
		data.set("bootstrap", start.bootstrap);
		data.set("email", "typo");
		expect((await state.post(start.endpoint, data, start.cookie)).status).toBe(
			422,
		);
	}
	expect(await spent(register, 5, 600000, "options")).toBe(1);
	const data = new FormData();
	data.set("bootstrap", start.bootstrap);
	data.set("email", "user@example.com");
	expect((await state.post(start.endpoint, data, start.cookie)).status).toBe(
		200,
	);
	expect(await spent(register, 5, 600000, "options")).toBe(2);
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
		(auth[mount]() as [Middleware])[0],
		Route.get("/session").use(async (c) => c.json(await c.session())),
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
			expect(await state.created()).toHaveLength(0);
		} finally {
			time.mockRestore();
		}
	},
);

test("oversized registration bodies are rejected without spending the signup budget", async () => {
	const storage = setup();
	const state = managed(storage);
	const data = new FormData();
	data.set("email", "x".repeat(129 * 1024));
	data.set("bootstrap", "invalid");
	const response = await state.post("/_passkey/options/register", data);
	expect(response.status).toBe(400);
	// the client policy runs after parsing
	expect(await rows(db.rate_limits)).toEqual([]);
	expect(await storage.size(db.auth_challenges)).toBe(0);
});

/** Checksums of the shipped migrations: never update them, add a new version instead. */
const checksums = {
	auth: "a004b98e623499f6670ffcee36ae4c61cbac67fd0754be942d2d2d61524792fd",
	limiter: "94fd469e8c2caa7331e532b764ae872352804a28527febb3decf5b09cf40ca70",
};

describe("migration SQL", () => {
	describe("check verifies Auth's foreign keys to the users table", () => {
		const settings = { secret: "test-secret-with-at-least-32-bytes", origin };
		const owners = ["auth_credentials", "auth_sessions", "auth_tokens"];
		/** Add each table's key with this definition, until `drop` */
		const add = async (definition: string) => {
			for (const table of owners)
				await run(
					`ALTER TABLE ${table} ADD CONSTRAINT ${table}_owner FOREIGN KEY ("user") ${definition}`,
				);
		};
		const drop = async () => {
			for (const table of owners)
				await run(
					`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_owner`,
				);
		};
		afterEach(drop);

		test("asks for Auth when it has not been created with the database", async () => {
			const database = new Database(pool, [users, ...Auth.tables]);
			expect(await database.check()).toEqual(
				owners.map(
					(table) =>
						`${table}.user: create Auth with this database before checking it, so it knows the table ${table} references`,
				),
			);
		});

		test("reports missing keys, and passes with the documented migration", async () => {
			new Auth({ ...settings, database: db, users });
			expect(await db.check()).toEqual(
				owners.map(
					(table) =>
						`${table}.user: missing foreign key to users (id) ON DELETE CASCADE`,
				),
			);
			// the auth guide's migration
			await add("REFERENCES users ON DELETE CASCADE");
			expect(await db.check()).toEqual([]);
		});

		test.each([
			["REFERENCES users", "does not cascade deletes"],
			[
				"REFERENCES users ON DELETE CASCADE NOT VALID",
				"is NOT VALID, validate it",
			],
			[
				"REFERENCES users (email) ON DELETE CASCADE",
				"references another table or column",
			],
			[
				"REFERENCES others ON DELETE CASCADE",
				"references another table or column",
			],
		])("reports a key %s", async (definition, problem) => {
			new Auth({ ...settings, database: db, users });
			await run(
				"CREATE TABLE IF NOT EXISTS others (id text PRIMARY KEY); CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)",
			);
			try {
				await add(definition);
				expect(await db.check()).toEqual(
					owners.map(
						(table) =>
							`${table}.user: foreign key ${problem}, expected users (id) ON DELETE CASCADE`,
					),
				);
			} finally {
				await drop();
				await run("DROP TABLE others; DROP INDEX users_email");
			}
		});

		test("each database expects its own users table, and one database has one", async () => {
			const members = new Table("members", {
				id: Schema.string(),
				email: Field.email(),
			});
			const other = new Database(pool, [members, ...Auth.tables]);
			new Auth({ ...settings, database: other, users: members });
			new Auth({ ...settings, database: db, users });
			await run(
				"CREATE TABLE members (id text PRIMARY KEY, email text NOT NULL)",
			);
			try {
				await add("REFERENCES users ON DELETE CASCADE");
				// the same keys satisfy one database and not the other
				expect(await db.check()).toEqual([]);
				expect(await other.check()).toEqual(
					owners.map(
						(table) =>
							`${table}.user: foreign key references another table or column, expected members (id) ON DELETE CASCADE`,
					),
				);
				// Auth's tables in one database reference one users table
				const both = new Database(pool, [users, members, ...Auth.tables]);
				new Auth({ ...settings, database: both, users });
				expect(
					() => new Auth({ ...settings, database: both, users: members }),
				).toThrow("already belong to the users table");
			} finally {
				await drop();
				await run("DROP TABLE members");
			}
		});

		test("follows a users table in another Postgres schema", async () => {
			const accounts = new Table(
				"accounts",
				{ id: Schema.string(), email: Field.email() },
				{ schema: "app" },
			);
			const database = new Database(pool, [accounts, ...Auth.tables]);
			new Auth({ ...settings, database, users: accounts });
			await run(
				"CREATE SCHEMA app; CREATE TABLE app.accounts (id text PRIMARY KEY, email text NOT NULL)",
			);
			try {
				await add("REFERENCES app.accounts ON DELETE CASCADE");
				expect(await database.check()).toEqual([]);
			} finally {
				await drop();
				await run("DROP SCHEMA app CASCADE");
			}
		});
	});

	test("Auth's tables bring their migrations, applied before the app's", async () => {
		expect(applied).toEqual(["auth:1", "rate_limits:1", "0001_users"]);
		// applied, so nothing runs again
		expect(await db.migrate([own])).toEqual([]);
	});

	test("Auth and Limiter need their tables in the database", () => {
		const bare = new Database(
			{
				query: async () => ({ rows: [] }),
				connect: async () => {
					throw new Error("Not connected");
				},
			},
			[users],
		);
		// type errors, never run
		void (() => {
			new Auth({
				secret: "test-secret-with-at-least-32-bytes",
				origin,
				// @ts-expect-error Auth.tables are missing
				database: bare,
				users,
			});
			// @ts-expect-error Limiter.table is missing
			new Limiter("requests", { database: bare });
		});
	});

	test("Auth creates accounts in a users table it can insert into", () => {
		const settings = { secret: "test-secret-with-at-least-32-bytes", origin };
		const pool = {
			query: async () => ({ rows: [] }),
			connect: async () => {
				throw new Error("Not connected");
			},
		};
		const shape = {
			id: Schema.string(),
			email: Field.email(),
			plan: Schema.string(),
			note: Schema.string().nullable(),
		};
		const defaulted = new Table("people", shape, { default: ["plan"] });
		new Auth({
			...settings,
			database: new Database(pool, [defaulted, ...Auth.tables]),
			users: defaulted,
		});
		// type errors, never run
		void (() => {
			const people = new Table("people", shape);
			new Auth({
				...settings,
				database: new Database(pool, [people, ...Auth.tables]),
				// @ts-expect-error registration only fills fields, plan needs a default
				users: people,
			});
		});
		void (() => {
			const people = new Table("people", { email: Field.email() });
			new Auth({
				...settings,
				database: new Database(pool, [people, ...Auth.tables]),
				// @ts-expect-error a users table needs an id column
				users: people,
			});
			const reserved = new Table("reserved", {
				id: Schema.string(),
				credential: Field.text(),
			});
			new Auth({
				...settings,
				database: new Database(pool, [reserved, ...Auth.tables]),
				// @ts-expect-error passkey forms send credential themselves
				users: reserved,
			});
			new Auth({
				...settings,
				// @ts-expect-error the users table is missing
				database: new Database(pool, [...Auth.tables]),
				users,
			});
		});
	});

	test("reading a session needs app.use(auth)", async () => {
		const app = new App().use(
			Route.get("/").use(async (c) => c.json(await c.session())),
		);
		await expect(app.fetch(`${origin}/`)).rejects.toThrow("app.use(auth)");
	});

	const [auth] = owned.get(Storage.credentials)!;
	const [limiter] = owned.get(Limiter.table)!;

	// an applied migration's checksum must never change, new SQL ships as a new version
	test.each([
		["auth:1", auth!.sql, checksums.auth],
		["rate_limits:1", limiter!.sql, checksums.limiter],
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
		expect(await inspect.size(db.auth_challenges)).toBe(11);
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
		await db.sql`INSERT INTO ${db.auth_credentials} ${db.sql.values(db.auth_credentials, credential)}`;
		const next = { ...credential, counter: 2, backedUp: true };
		expect(await storage.credentials.update(next, credential)).toBe(true);
		// the stored counter has moved on, so the stale snapshot loses
		expect(
			await storage.credentials.update({ ...next, counter: 3 }, credential),
		).toBe(false);
		expect(await storage.credentials.get("credential")).toEqual(next);
		await db.sql`DELETE FROM ${db.auth_credentials}`;
		expect(await storage.credentials.update(next, next)).toBe(false);
		expect(await inspect.size(db.auth_credentials)).toBe(0);
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
		expect(await rows(db.auth_credentials)).toEqual([credential]);
	});

	test("prunes expired sessions and challenges", async () => {
		const now = Date.now();
		await storage.sessions.set("old", {
			id: "old",
			user: "u",
			expiration: now + 1,
			started: now,
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
			started: now,
		});
		expect((await rows(db.auth_sessions)).map((session) => session.id)).toEqual(
			["new"],
		);
		expect(await inspect.size(db.auth_challenges)).toBe(0);
	});
});

describe("agents", () => {
	const ip = "203.0.113.9";
	const mcp = `${origin}/mcp`;
	const callback = "http://127.0.0.1:4000/callback";
	const agent = "https://agent.example/client.json";

	/** Client ID metadata documents the agents host */
	const documents: Record<string, unknown> = {
		[agent]: {
			client_id: agent,
			client_name: "Test Agent",
			redirect_uris: [callback],
		},
		"https://agent.example/web.json": {
			client_id: "https://agent.example/web.json",
			redirect_uris: ["https://agent.example/cb"],
		},
		"https://agent.example/unsafe.json": {
			client_id: "https://agent.example/unsafe.json",
			redirect_uris: ["javascript:alert(1)"],
		},
		"https://agent.example/other.json": {
			client_id: agent,
			redirect_uris: [callback],
		},
		// declares what this server offers, among others
		"https://agent.example/declared.json": {
			client_id: "https://agent.example/declared.json",
			redirect_uris: [callback],
			token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
		// each declares only what it does not
		"https://agent.example/key.json": {
			client_id: "https://agent.example/key.json",
			redirect_uris: [callback],
			token_endpoint_auth_method: "private_key_jwt",
		},
		"https://agent.example/secret.json": {
			client_id: "https://agent.example/secret.json",
			redirect_uris: [callback],
			token_endpoint_auth_methods_supported: ["client_secret_basic"],
		},
		"https://agent.example/device.json": {
			client_id: "https://agent.example/device.json",
			redirect_uris: [callback],
			grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
		},
		"https://agent.example/implicit.json": {
			client_id: "https://agent.example/implicit.json",
			redirect_uris: [callback],
			response_types: ["token"],
		},
	};

	function agents() {
		vi.spyOn(Metadata, "fetch").mockImplementation(
			async (url) => documents[url.href],
		);

		const auth = new Auth({
			secret: "test-secret-with-at-least-32-bytes",
			origin,
			database: db,
			consent: "/connect",
			users,
		});
		const notes = Route.post("/notes")
			.describe("Write a note")
			.fields({ text: Field.text() })
			.use(async (c) => {
				const session = await c.session();
				if (!session) return c.text("Unauthorized", 401);
				const result = await c.data();
				if (result.issues) return;
				return c.text(`${session.user} wrote ${result.data.text}`);
			});
		const app = new App().use(
			auth,
			new Mcp({ auth }),
			notes,
			Route.get("/sign-in").use(async (c) => {
				// an account, which agents' tokens need to exist
				await db.sql`
					INSERT INTO ${db.users} (id, email) VALUES (${user}, 'user@example.com')
					ON CONFLICT (id) DO NOTHING
				`;
				await auth.login(c, user);
				return c.text("signed in");
			}),
			Route.get("/connect").use(async (c) => {
				const request = await auth.consent(c);
				if (!request) return c.text("No request", 400);
				return jsx("main", {
					children: [
						jsx("h1", { children: `Allow ${request.client.name}?` }),
						jsx("p", { children: new URL(request.client.id).origin }),
						jsx("p", { children: request.redirect }),
						request.Form({}),
					],
				});
			}),
		);

		/** Browser with a cookie jar */
		const cookies = new Map<string, string>();
		const browser = async (url: string, init: RequestInit = {}) => {
			const headers = new Headers(init.headers);
			headers.set(
				"cookie",
				Array.from(cookies, ([k, v]) => `${k}=${v}`).join("; "),
			);
			const res = await app.fetch(new URL(url, origin), {
				...init,
				headers,
				ip,
			});
			for (const cookie of res.headers.getSetCookie()) {
				const [pair] = cookie.split(";");
				const [name, value] = pair!.split("=") as [string, string];
				if (value) cookies.set(name, value);
				else cookies.delete(name);
			}
			return res;
		};

		return { auth, app, browser };
	}

	const verifier = "v".repeat(43);
	test("the token endpoint answers its advertised browser preflight", async () => {
		const { app } = agents();
		const res = await app.fetch(`${origin}/oauth/token`, {
			method: "OPTIONS",
			headers: {
				origin: "https://agent.example",
				"sec-fetch-site": "cross-site",
				"access-control-request-method": "POST",
				"access-control-request-headers": "authorization",
			},
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-headers")).toContain(
			"authorization",
		);
	});

	const challenge = async () =>
		Codec.Base64Url.encode(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", Codec.encode(verifier)),
			),
		);

	/** @returns An HTML attribute's value, unescaped */
	const attribute = (html: string, name: string) =>
		new RegExp(`${name}="([^"]+)"`)
			.exec(html)![1]!
			.replaceAll("&quot;", '"')
			.replaceAll("&amp;", "&");

	const form = (values: Record<string, string>) => {
		const data = new FormData();
		for (const [name, value] of Object.entries(values)) data.set(name, value);
		return data;
	};

	/**
	 * Stores a passkey for a user.
	 *
	 * @param owner User the passkey belongs to
	 * @returns Its keys
	 */
	const enroll = async (owner: string) => {
		const keys = await pair();
		// one test passkey at a time
		await db.sql`DELETE FROM ${db.auth_credentials} WHERE id = ${id}`;
		await db.sql`INSERT INTO ${db.auth_credentials} ${db.sql.values(
			db.auth_credentials,
			{
				id,
				user: owner,
				publicKey: Codec.Base64Url.encode(
					new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey)),
				),
				counter: 0,
				eligible: false,
				backedUp: false,
			},
		)}`;
		return { keys, owner };
	};

	/**
	 * Allows the request on a consent page with a passkey.
	 *
	 * @param browser Browser with the user's cookies
	 * @param html Consent page
	 * @param passkey Passkey to sign with, `null` to submit without one
	 */
	const allow = async (
		browser: (url: string, init?: RequestInit) => Promise<Response>,
		html: string,
		passkey: { keys: CryptoKeyPair; owner: string } | null,
	) => {
		const request = attribute(html, 'name="request" value');
		if (!passkey)
			return browser("/oauth/approve", {
				method: "POST",
				body: form({ request, credential: "", ceremony: "" }),
				headers: { origin },
			});

		// the browser module sends the form's fields with the bootstrap
		const started = await browser(attribute(html, "data-endpoint"), {
			method: "POST",
			body: form({ request, bootstrap: attribute(html, "data-bootstrap") }),
			headers: { origin },
		});
		expect(started.status).toBe(200);
		const { ceremony, options } = await started.json();
		const credential = await assertion(options.challenge, passkey.keys, {
			handle: passkey.owner,
		});
		return browser("/oauth/approve", {
			method: "POST",
			body: form({ request, credential: JSON.stringify(credential), ceremony }),
			headers: { origin },
		});
	};

	/** Registers a client, signs in, approves it, and exchanges the code */
	async function connect(decision = "allow", prepare?: (app: App) => void) {
		const state = agents();
		// such as global middleware, in place before anyone signs in
		prepare?.(state.app);
		const { browser } = state;
		const client_id = agent;

		const authorize = new URL(`${origin}/oauth/authorize`);
		authorize.search = new URLSearchParams({
			response_type: "code",
			client_id,
			redirect_uri: "http://127.0.0.1:5123/callback",
			code_challenge: await challenge(),
			code_challenge_method: "S256",
			state: "xyz",
			resource: mcp,
		}).toString();

		// signed out: to the login page, and back after logging in
		const first = await browser(authorize.href);
		expect(first.headers.get("location")).toBe("/login");
		await browser("/sign-in");

		const consent = await browser(authorize.href);
		const page = new URL(consent.headers.get("location")!);
		expect(page.pathname).toBe("/connect");

		const consentPage = await browser(page.href);
		const html = await consentPage.text();
		expect(html).toContain("Allow Test Agent?");
		// the client ID's origin, who publishes the agent
		expect(html).toContain(new URL(agent).origin);
		expect(html).toContain("127.0.0.1:5123");
		const request = attribute(html, 'name="request" value');

		const approved =
			decision === "allow"
				? await allow(browser, html, await enroll(user))
				: await browser("/oauth/deny", {
						method: "POST",
						body: form({ request }),
						headers: { origin },
					});
		const redirect = new URL(approved.headers.get("location")!);
		expect(redirect.origin + redirect.pathname).toBe(
			"http://127.0.0.1:5123/callback",
		);
		expect(redirect.searchParams.get("state")).toBe("xyz");
		expect(redirect.searchParams.get("iss")).toBe(origin);

		return {
			...state,
			client_id,
			redirect,
			consentHeaders: consentPage.headers,
		};
	}

	const token = (app: App, body: Record<string, string>) =>
		app.fetch(`${origin}/oauth/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ resource: mcp, ...body }),
			ip,
		});

	const call = (app: App, access: string | undefined, text: string) =>
		app.fetch(mcp, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"mcp-protocol-version": "2026-07-28",
				"mcp-method": "tools/call",
				"mcp-name": "post_notes",
				...(access ? { authorization: `Bearer ${access}` } : {}),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "post_notes",
					arguments: { text },
					_meta: {
						"io.modelcontextprotocol/protocolVersion": "2026-07-28",
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
			ip,
		});

	test("the code exchange needs redirect_uri only when the authorization request named it", async () => {
		for (const named of [false, true]) {
			const { app, browser } = agents();
			const authorize = new URL(`${origin}/oauth/authorize`);
			authorize.search = new URLSearchParams({
				response_type: "code",
				client_id: agent,
				// the agent registered one callback, so it may be left out
				...(named && { redirect_uri: callback }),
				code_challenge: await challenge(),
				code_challenge_method: "S256",
				resource: mcp,
			}).toString();
			await browser("/sign-in");
			const consent = await browser(authorize.href);
			const html = await (
				await browser(consent.headers.get("location")!)
			).text();
			const approved = await allow(browser, html, await enroll(user));
			const location = new URL(approved.headers.get("location")!);
			expect(location.origin + location.pathname).toBe(callback);

			const exchanged = await token(app, {
				grant_type: "authorization_code",
				client_id: agent,
				code: location.searchParams.get("code")!,
				code_verifier: verifier,
			});
			expect(exchanged.status).toBe(named ? 400 : 200);
		}
	});

	test("a grant ends 30 days after approval, however often it is refreshed", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			const { app, client_id, redirect } = await connect();
			let issued = await (
				await token(app, {
					grant_type: "authorization_code",
					client_id,
					code: redirect.searchParams.get("code")!,
					redirect_uri: "http://127.0.0.1:5123/callback",
					code_verifier: verifier,
				})
			).json();
			const end = now + 30 * Time.day;

			// refreshing near the end keeps the end, and its access token stops there
			clock.mockReturnValue(end - 30 * Time.minute);
			const refreshed = await token(app, {
				grant_type: "refresh_token",
				client_id,
				refresh_token: issued.refresh_token,
			});
			expect(refreshed.status).toBe(200);
			issued = await refreshed.json();
			expect(issued.expires_in).toBe(30 * 60);
			expect((await call(app, issued.access_token, "late")).status).toBe(200);

			// then neither token works, the user connects the agent again
			clock.mockReturnValue(end);
			expect((await call(app, issued.access_token, "ended")).status).toBe(401);
			expect(
				(
					await token(app, {
						grant_type: "refresh_token",
						client_id,
						refresh_token: issued.refresh_token,
					})
				).status,
			).toBe(400);
		} finally {
			clock.mockRestore();
		}
	});

	test("disconnecting an agent revokes its tokens, and needs a signed-in user", async () => {
		const { app, auth, browser, client_id, redirect } = await connect();
		app.use(
			Route.post("/disconnect").use(async (c) => {
				await auth.disconnect(c, client_id);
				return c.text("disconnected");
			}),
		);
		const issued = await (
			await token(app, {
				grant_type: "authorization_code",
				client_id,
				code: redirect.searchParams.get("code")!,
				redirect_uri: "http://127.0.0.1:5123/callback",
				code_verifier: verifier,
			})
		).json();
		expect((await call(app, issued.access_token, "connected")).status).toBe(
			200,
		);

		// signed out, nothing is disconnected
		await expect(
			app.fetch(`${origin}/disconnect`, {
				method: "POST",
				headers: { origin },
			}),
		).rejects.toThrow("Sign in to disconnect an agent");
		expect((await call(app, issued.access_token, "still")).status).toBe(200);

		const done = await browser("/disconnect", {
			method: "POST",
			headers: { origin },
		});
		expect(await done.text()).toBe("disconnected");
		expect((await call(app, issued.access_token, "gone")).status).toBe(401);
		expect(
			(
				await token(app, {
					grant_type: "refresh_token",
					client_id,
					refresh_token: issued.refresh_token,
				})
			).status,
		).toBe(400);
	});

	test("account deletion following the Auth guide revokes browser and agent access", async () => {
		// the three cascading foreign keys in the Auth guide's migration
		await db.sql`ALTER TABLE auth_credentials ADD CONSTRAINT deletion_credentials
			FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE`;
		await db.sql`ALTER TABLE auth_sessions ADD CONSTRAINT deletion_sessions
			FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE`;
		await db.sql`ALTER TABLE auth_tokens ADD CONSTRAINT deletion_tokens
			FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE`;
		try {
			await db.sql`INSERT INTO users (id, email) VALUES (${user}, 'user@example.com')`;
			const { app, browser, client_id, redirect } = await connect();
			const response = await token(app, {
				grant_type: "authorization_code",
				client_id,
				code: redirect.searchParams.get("code")!,
				redirect_uri: "http://127.0.0.1:5123/callback",
				code_verifier: verifier,
			});
			expect(response.status).toBe(200);
			const issued = await response.json();
			expect(
				(await call(app, issued.access_token, "before deletion")).status,
			).toBe(200);

			await db.sql`DELETE FROM users WHERE id = ${user}`;
			expect((await rows(db.auth_credentials)).length).toBe(0);
			expect((await rows(db.auth_sessions)).length).toBe(0);
			expect(
				(await browser("/notes", { method: "POST", headers: { origin } }))
					.status,
			).toBe(401);
			expect
				.soft((await call(app, issued.access_token, "after deletion")).status)
				.toBe(401);
			expect
				.soft(
					(
						await token(app, {
							grant_type: "refresh_token",
							client_id,
							refresh_token: issued.refresh_token,
						})
					).status,
				)
				.toBe(400);
		} finally {
			await db.sql`ALTER TABLE auth_credentials DROP CONSTRAINT deletion_credentials`;
			await db.sql`ALTER TABLE auth_sessions DROP CONSTRAINT deletion_sessions`;
			await db.sql`ALTER TABLE auth_tokens DROP CONSTRAINT deletion_tokens`;
		}
	});

	test("metadata points agents to the authorization server", async () => {
		const { app } = agents();

		const resource = await app.fetch(
			`${origin}/.well-known/oauth-protected-resource/mcp`,
		);
		expect(await resource.json()).toMatchObject({
			resource: mcp,
			authorization_servers: [origin],
		});

		const server = await app.fetch(
			`${origin}/.well-known/oauth-authorization-server`,
		);
		expect(server.headers.get("access-control-allow-origin")).toBe("*");
		expect(await server.json()).toMatchObject({
			issuer: origin,
			authorization_endpoint: `${origin}/oauth/authorize`,
			token_endpoint: `${origin}/oauth/token`,
			code_challenge_methods_supported: ["S256"],
			client_id_metadata_document_supported: true,
		});
		expect(
			await (
				await app.fetch(`${origin}/.well-known/oauth-authorization-server`)
			).json(),
		).not.toHaveProperty("registration_endpoint");

		const unauthorized = await call(app, undefined, "hi");
		expect(unauthorized.status).toBe(401);
		expect(unauthorized.headers.get("www-authenticate")).toBe(
			`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
		);
	});

	test("metadata documents are never fetched from special-use addresses", async () => {
		const net = process.getBuiltinModule("node:net");
		let connections = 0;
		const server = net.createServer((socket) => {
			connections++;
			socket.destroy();
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as { port: number };

		try {
			for (const host of [
				"localhost",
				"localhost.",
				"127.0.0.1",
				"[::1]",
				"[::ffff:127.0.0.1]",
			])
				expect(
					await Metadata.fetch(new URL(`https://${host}:${port}/client.json`)),
				).toBeUndefined();
			expect(connections).toBe(0);
		} finally {
			server.close();
		}
	});

	test("metadata documents are fetched from public addresses", async () => {
		const dns = process.getBuiltinModule("node:dns");
		const https = process.getBuiltinModule("node:https");
		const { Readable } = process.getBuiltinModule("node:stream");
		const { EventEmitter } = process.getBuiltinModule("node:events");

		vi.spyOn(dns, "lookup").mockImplementation(((
			_hostname: string,
			_options: unknown,
			callback: Function,
		) =>
			callback(null, [
				{ address: "8.8.8.8", family: 4 },
				{ address: "2606:4700::1", family: 6 },
			])) as any);
		// connects through the lookup, without the network
		vi.spyOn(https, "get").mockImplementation(((
			_url: URL,
			options: any,
			callback: Function,
		) => {
			options.lookup("agent.example", { all: true }, (error: unknown) => {
				if (error) throw error;
				callback(
					Object.assign(Readable.from([Buffer.from('{"client_id":"a"}')]), {
						statusCode: 200,
					}),
				);
			});
			return new EventEmitter();
		}) as any);

		try {
			expect(
				await Metadata.fetch(new URL("https://agent.example/client.json")),
			).toEqual({ client_id: "a" });
		} finally {
			vi.restoreAllMocks();
		}
	});

	test.each([
		[404, undefined],
		[410, undefined],
		[429, null],
		[503, null],
	])(
		"a %i response is %s: final, or worth retrying",
		async (status, expected) => {
			const dns = process.getBuiltinModule("node:dns");
			const https = process.getBuiltinModule("node:https");
			const { Readable } = process.getBuiltinModule("node:stream");
			const { EventEmitter } = process.getBuiltinModule("node:events");

			vi.spyOn(dns, "lookup").mockImplementation(((
				_hostname: string,
				_options: unknown,
				callback: Function,
			) => callback(null, [{ address: "8.8.8.8", family: 4 }])) as any);
			vi.spyOn(https, "get").mockImplementation(((
				_url: URL,
				options: any,
				callback: Function,
			) => {
				options.lookup("agent.example", { all: true }, (error: unknown) => {
					if (error) throw error;
					callback(Object.assign(Readable.from([]), { statusCode: status }));
				});
				return new EventEmitter();
			}) as any);

			try {
				expect(
					await Metadata.fetch(new URL("https://agent.example/client.json")),
				).toBe(expected);
			} finally {
				vi.restoreAllMocks();
			}
		},
	);

	test("a pooled socket to a private address cannot serve a metadata request", async () => {
		const http = process.getBuiltinModule("node:http");
		const https = process.getBuiltinModule("node:https");
		const net = process.getBuiltinModule("node:net");
		const { once } = process.getBuiltinModule("node:events");
		let requests = 0;
		const server = http.createServer((_req, res) => {
			requests++;
			res.end('{"private":true}');
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing port");
		const { port } = address;
		const socket = net.connect(port, "127.0.0.1");
		const key = https.globalAgent.getName({ host: "localhost", port });
		try {
			await once(socket, "connect");
			// Model an idle connection established by another caller. Node writes
			// the HTTP request straight to the pooled socket without a new lookup.
			Object.assign(https.globalAgent.freeSockets, { [key]: [socket] });
			await Metadata.fetch(new URL(`https://localhost:${port}/client.json`));
			expect(requests).toBe(0);
		} finally {
			Reflect.deleteProperty(https.globalAgent.freeSockets, key);
			socket.destroy();
			server.close();
		}
	});

	test("a trickling metadata response cannot keep a download slot indefinitely", async () => {
		const http = process.getBuiltinModule("node:http");
		const https = process.getBuiltinModule("node:https");
		const { once } = process.getBuiltinModule("node:events");
		const server = http.createServer((_req, res) => {
			res.write("{");
			const timer = setInterval(() => res.write(" "), 100);
			res.on("close", () => clearInterval(timer));
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing port");
		// Substitute only the destination and transport. The real request still
		// receives the downloader's deadline, timeout and cancellation options.
		vi.spyOn(https, "get").mockImplementation((_url, options, callback) =>
			http.get(new URL(`http://127.0.0.1:${address.port}/`), options, callback),
		);
		let done = false;
		const download = Metadata.fetch(
			new URL("https://slow.invalid/metadata"),
		).finally(() => {
			done = true;
		});
		try {
			await vi.waitFor(() => expect(done).toBe(true), {
				timeout: 6500,
				interval: 100,
			});
		} finally {
			server.closeAllConnections();
			server.close();
			await download;
		}
	}, 10000);

	test("an issuer-origin token cannot authenticate a different origin's resource", async () => {
		const { auth } = agents();
		await storage.tokens.set("test-access", {
			kind: "access",
			user: "user-1",
			client: "agent",
			resource: origin,
			scope: "",
			expiration: Date.now() + 60000,
		});
		const resource = "https://other.example/mcp";
		const req = new Request(resource, {
			headers: { authorization: "Bearer test-access" },
		});
		expect(await auth[signin].bearer({ req }, resource)).toBeNull();
	});

	test("the OAuth consent page prevents framing by another origin", async () => {
		const { consentHeaders } = await connect();
		expect(
			/^(deny|sameorigin)$/i.test(
				consentHeaders.get("x-frame-options") ?? "",
			) ||
				/(?:^|;)\s*frame-ancestors\s+'(?:self|none)'\s*(?:;|$)/i.test(
					consentHeaders.get("content-security-policy") ?? "",
				),
		).toBe(true);
	});

	test("a refresh for an account that no longer exists is refused", async () => {
		const { app } = agents();
		// no foreign key here, so only Auth's check of the account refuses it
		await storage.tokens.set("orphan-refresh", {
			kind: "refresh",
			user: "deleted-user",
			client: "agent",
			resource: mcp,
			scope: "",
			expiration: Date.now() + 60000,
		});
		const refreshed = await token(app, {
			grant_type: "refresh_token",
			client_id: "agent",
			refresh_token: "orphan-refresh",
		});
		expect(refreshed.status).toBe(400);
		expect(await refreshed.json()).toEqual({ error: "invalid_grant" });
	});

	test("replaying a used code minutes later still revokes its tokens", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			const { app, client_id, redirect } = await connect();
			const exchange = () =>
				token(app, {
					grant_type: "authorization_code",
					client_id,
					code: redirect.searchParams.get("code")!,
					redirect_uri: "http://127.0.0.1:5123/callback",
					code_verifier: verifier,
				});
			const issued = await (await exchange()).json();

			// past the code's own minute, and pruning has run
			clock.mockReturnValue(now + 3 * Time.minute);
			await storage.tokens.set("prune-trigger", {
				kind: "access",
				user,
				client: client_id,
				resource: mcp,
				scope: "",
				expiration: now + 4 * Time.minute,
			});
			expect((await exchange()).status).toBe(400);
			expect((await call(app, issued.access_token, "stolen")).status).toBe(401);
		} finally {
			clock.mockRestore();
		}
	});

	test("replaying a spent refresh token revokes its active successor", async () => {
		const { app } = agents();
		await db.sql`INSERT INTO ${db.users} (id, email) VALUES (${user}, 'user@example.com')`;
		await storage.tokens.set("first-refresh", {
			kind: "refresh",
			user: "user-1",
			client: "agent",
			resource: mcp,
			scope: "",
			expiration: Date.now() + 60000,
		});
		const refresh = (value: string) =>
			token(app, {
				grant_type: "refresh_token",
				client_id: "agent",
				refresh_token: value,
			});
		const rotated = await refresh("first-refresh");
		expect(rotated.status).toBe(200);
		const { refresh_token } = await rotated.json();
		expect((await refresh("first-refresh")).status).toBe(400);
		expect((await refresh(refresh_token)).status).toBe(400);
	});

	test("a failed refresh leaves the original token usable and no orphan access token", async () => {
		const { app } = agents();
		await db.sql`INSERT INTO ${db.users} (id, email) VALUES (${user}, 'user@example.com')`;
		await storage.tokens.set("original", {
			kind: "refresh",
			user: "user-1",
			client: "agent",
			resource: mcp,
			scope: "",
			expiration: Date.now() + 60000,
		});
		const refresh = () =>
			token(app, {
				grant_type: "refresh_token",
				client_id: "agent",
				refresh_token: "original",
			});
		// Fail only the write of the replacement refresh token.
		await engine.exec(
			"ALTER TABLE auth_tokens ADD CONSTRAINT fail_refresh CHECK (kind <> 'refresh') NOT VALID",
		);
		try {
			await refresh().catch(() => undefined);
		} finally {
			await engine.exec("ALTER TABLE auth_tokens DROP CONSTRAINT fail_refresh");
		}
		expect((await rows(db.auth_tokens)).map((row) => row.kind)).toEqual([
			"refresh",
		]);
		expect((await refresh()).status).toBe(200);
	});

	test.each(["token"])(
		"OAuth %s stops reading at the body limit",
		async (endpoint) => {
			const { app } = agents();
			let pulls = 0;
			const body = new ReadableStream<Uint8Array>(
				{
					pull(controller) {
						if (++pulls === 1)
							controller.enqueue(new Uint8Array(16 * 1024 + 1));
						else controller.close();
					},
				},
				{ highWaterMark: 0 },
			);
			const req = new Request(new URL("/oauth/" + endpoint, origin), {
				method: "POST",
				body,
				...{ duplex: "half" },
				headers: {
					"content-type":
						endpoint === "token"
							? "application/x-www-form-urlencoded"
							: "application/json",
				},
			});
			const res = await app.fetch(req, { ip });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(pulls).toBe(1);
		},
	);

	test("an unknown scope cannot reach the consent page as a grantable permission", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const query = new URLSearchParams({
			response_type: "code",
			client_id: agent,
			redirect_uri: callback,
			code_challenge: await challenge(),
			code_challenge_method: "S256",
			resource: mcp,
			scope: "unknown:permission",
		});
		const res = await browser("/oauth/authorize?" + query);
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("(invalid_scope)");
	});

	test("global middleware sees an agent's call once, as the route's request by its user", async () => {
		const { app, client_id, redirect } = await connect();
		const { access_token } = await (
			await token(app, {
				grant_type: "authorization_code",
				code: redirect.searchParams.get("code")!,
				client_id,
				redirect_uri: redirect.origin + redirect.pathname,
				code_verifier: verifier,
			})
		).json();

		// global middleware, such as a limiter that counts each signed-in user
		const seen: [string, string | undefined][] = [];
		const each = new Limiter("each-user", {
			database: db,
			limit: 2,
			key: async (c) => (await c.session())?.user,
		});
		app.use(async (c, next) => {
			seen.push([c.url.pathname, (await c.session())?.user]);
			return next();
		}, each.middleware);

		const said = async (text: string) => {
			const res = await call(app, access_token, text);
			return res.status === 200
				? (await res.json()).result.content[0].text
				: res.status;
		};

		// the endpoint is outside the app's middleware, which sees the request
		// it makes to the route, with the user
		expect(await said("one")).toBe(`${user} wrote one`);
		expect(seen).toEqual([["/notes", user]]);
		// each tool call counted once for the user, and refused as the route
		// would refuse a person
		expect(await said("two")).toBe(`${user} wrote two`);
		expect(await said("three")).toContain("429");

		// a token is a session only on the endpoint it was issued for, so
		// elsewhere nobody is signed in, and the limiter has no user to count
		seen.length = 0;
		await expect(
			app.fetch(`${origin}/sign-in`, {
				headers: { authorization: `Bearer ${access_token}` },
				ip: "192.0.2.77",
			}),
		).rejects.toThrow("Rate limiting requires");
		expect(seen[0]).toEqual(["/sign-in", undefined]);
	});

	test("an agent signs in and calls a tool with a check for a session in global middleware", async () => {
		// in place from the start: everything but the sign-in pages needs a session
		const wall: Middleware = async (c, next) =>
			["/login", "/sign-in"].includes(c.url.pathname) || (await c.session())
				? next()
				: c.redirect("/login", 303);
		const { app, browser, client_id, redirect } = await connect(
			"allow",
			(app) => app.use(wall),
		);
		const anyone = (path: string, init?: RequestInit) =>
			app.fetch(origin + path, { ...init, ip });

		// the check is real for the app's pages and for the user's own form posts
		expect((await anyone("/notes", { method: "POST" })).status).toBe(303);
		expect(
			(
				await anyone("/oauth/deny", { method: "POST", body: new FormData() })
			).headers.get("location"),
		).toBe("/login");

		// an agent without a token is told how to sign in
		const unsigned = await call(app, undefined, "x");
		expect(unsigned.status).toBe(401);
		const metadata = /resource_metadata="([^"]+)"/.exec(
			unsigned.headers.get("www-authenticate")!,
		)![1]!;

		// and can find where: both documents, without a session
		const resource = await (await app.fetch(metadata, { ip })).json();
		expect(resource).toMatchObject({
			resource: mcp,
			authorization_servers: [origin],
		});
		const server = await (
			await anyone("/.well-known/oauth-authorization-server")
		).json();
		expect(server.token_endpoint).toBe(`${origin}/oauth/token`);

		// `connect` sent the signed-out user through the login page and back to
		// the request, then the agent exchanges its code, without a session
		const exchanged = await token(app, {
			grant_type: "authorization_code",
			code: redirect.searchParams.get("code")!,
			client_id,
			redirect_uri: redirect.origin + redirect.pathname,
			code_verifier: verifier,
		});
		expect(exchanged.status).toBe(200);
		const { access_token } = await exchanged.json();

		// its tool call passes the check as the user
		expect(
			(await (await call(app, access_token, "walled")).json()).result.content[0]
				.text,
		).toBe(`${user} wrote walled`);

		// the user's form posts are still the app's: a signed-in browser's
		// cross-site post is refused
		const forged = await browser("/oauth/deny", {
			method: "POST",
			body: new FormData(),
			headers: {
				origin: "https://evil.example",
				"sec-fetch-site": "cross-site",
			},
		});
		expect(forged.status).toBe(403);
	});

	test("the endpoints an agent signs in through refuse another host", async () => {
		const { app } = agents();
		const wrong = "https://wrong.example";

		for (const [method, path] of [
			["GET", "/.well-known/oauth-authorization-server"],
			["OPTIONS", "/.well-known/oauth-authorization-server"],
			["GET", "/oauth/authorize?client_id=x"],
			["POST", "/oauth/token"],
			["OPTIONS", "/oauth/token"],
			["POST", "/oauth/approve"],
			["POST", "/oauth/deny"],
		] as const) {
			const res = await app.fetch(wrong + path, {
				method,
				...(method === "POST" && { body: new FormData() }),
				ip,
			});

			expect(res.status, `${method} ${path}`).toBe(421);
			expect(res.headers.get("cache-control")).toBe("no-store");
		}

		// the endpoint's own document names the configured origin's endpoint,
		// whatever host asks
		expect(
			await (
				await app.fetch(`${wrong}/.well-known/oauth-protected-resource/mcp`, {
					ip,
				})
			).json(),
		).toMatchObject({ resource: mcp, authorization_servers: [origin] });
	});

	test("the user approves, and the agent acts as the user", async () => {
		const { app, client_id, redirect } = await connect();
		const code = redirect.searchParams.get("code")!;

		const wrong = await token(app, {
			grant_type: "authorization_code",
			code,
			client_id,
			redirect_uri: redirect.origin + redirect.pathname,
			code_verifier: "w".repeat(43),
		});
		expect(wrong.status).toBe(400);
		expect(await wrong.json()).toEqual({ error: "invalid_grant" });

		// the failed attempt used the code
		const { redirect: again, client_id: second, app: other } = await connect();
		const exchanged = await token(other, {
			grant_type: "authorization_code",
			code: again.searchParams.get("code")!,
			client_id: second,
			redirect_uri: again.origin + again.pathname,
			code_verifier: verifier,
			resource: mcp,
		});
		expect(exchanged.status).toBe(200);
		expect(exchanged.headers.get("cache-control")).toBe("no-store");
		const tokens = await exchanged.json();
		expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });

		const res = await call(other, tokens.access_token, "hello");
		expect((await res.json()).result.content[0].text).toBe(
			"user-1 wrote hello",
		);

		// refresh tokens rotate
		const refreshed = await token(other, {
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token,
			client_id: second,
		});
		const next = await refreshed.json();
		expect(next.access_token).not.toBe(tokens.access_token);

		const reused = await token(other, {
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token,
			client_id: second,
		});
		expect(reused.status).toBe(400);

		const audience = await other.fetch(mcp, {
			method: "POST",
			headers: {
				authorization: "Bearer nope",
				"content-type": "application/json",
			},
			body: "{}",
		});
		expect(audience.status).toBe(401);
		void app;
	});

	test("allowing an agent needs the asked user's passkey", async () => {
		const { browser } = agents();
		const authorize = new URL(`${origin}/oauth/authorize`);
		authorize.search = new URLSearchParams({
			response_type: "code",
			client_id: agent,
			redirect_uri: callback,
			code_challenge: await challenge(),
			code_challenge_method: "S256",
			resource: mcp,
		}).toString();
		await browser("/sign-in");
		const consent = await browser(authorize.href);
		const html = await (await browser(consent.headers.get("location")!)).text();
		expect(html).toContain(`formaction="/oauth/deny"`);

		// a script driving the signed-in browser cannot press Allow
		const unsigned = await allow(browser, html, null);
		expect(unsigned.status).toBe(400);

		// another user's passkey cannot allow it either
		const other = await allow(browser, html, await enroll("user-2"));
		expect(other.status).toBe(403);

		expect(
			await db.sql`SELECT * FROM ${db.auth_tokens} WHERE kind = 'code'`,
		).toEqual([]);
	});

	/** The consent form a signed-in browser receives for a particular client. */
	async function consentPage(
		browser: ReturnType<typeof agents>["browser"],
		client: string,
		proof?: string,
	) {
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client,
			code_challenge: proof ?? (await challenge()),
			code_challenge_method: "S256",
			resource: mcp,
		});
		const redirect = await browser("/oauth/authorize?" + query);
		return (await browser(redirect.headers.get("location")!)).text();
	}

	test("the approval prompt accepts the fields sent by the consent form", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const html = await consentPage(browser, agent);
		// listen() serializes the form, deletes ceremony and credential, then adds bootstrap.
		const response = await browser(attribute(html, "data-endpoint"), {
			method: "POST",
			headers: { origin },
			body: form({
				request: attribute(html, 'name="request" value'),
				bootstrap: attribute(html, "data-bootstrap"),
			}),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toHaveProperty("options.challenge");
	});

	test("the approval prompt offers only the signed-in user's passkeys", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const passkey = (id: string, owner: string): Auth.Credential => ({
			id,
			user: owner,
			publicKey: "key",
			counter: 0,
			eligible: true,
			backedUp: false,
		});
		for (const credential of [
			passkey("mine-1", user),
			passkey("mine-2", user),
			passkey("theirs", "someone-else"),
		])
			await db.sql`INSERT INTO ${db.auth_credentials} ${db.sql.values(db.auth_credentials, credential)}`;

		const html = await consentPage(browser, agent);
		const response = await browser(attribute(html, "data-endpoint"), {
			method: "POST",
			headers: { origin },
			body: form({
				request: attribute(html, 'name="request" value'),
				bootstrap: attribute(html, "data-bootstrap"),
			}),
		});
		expect(response.status).toBe(200);
		const { options } = await response.json();
		expect(
			options.allowCredentials.map((c: { id: string }) => c.id).sort(),
		).toEqual(["mine-1", "mine-2"]);
		expect(options.allowCredentials[0].type).toBe("public-key");
	});

	test("an allowed passkey can approve an agent without returning a user handle", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const passkey = await enroll(user);
		const html = await consentPage(browser, agent);
		const request = attribute(html, 'name="request" value');
		const started = await browser(attribute(html, "data-endpoint"), {
			method: "POST",
			headers: { origin },
			body: form({ request, bootstrap: attribute(html, "data-bootstrap") }),
		});
		expect(started.status).toBe(200);
		const { ceremony, options } = await started.json();
		expect(options.allowCredentials).toHaveLength(1);
		const credential = await assertion(options.challenge, passkey.keys, {
			handle: null,
		});
		const approved = await browser("/oauth/approve", {
			method: "POST",
			headers: { origin },
			body: form({ request, ceremony, credential: JSON.stringify(credential) }),
		});
		expect(approved.status).toBe(303);
		expect(
			new URL(approved.headers.get("location")!).searchParams.get("code"),
		).toBeTruthy();
	});

	test("an allowed passkey can approve an agent with the user handle left out", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const passkey = await enroll(user);
		const html = await consentPage(browser, agent);
		const request = attribute(html, 'name="request" value');
		const started = await browser(attribute(html, "data-endpoint"), {
			method: "POST",
			headers: { origin },
			body: form({ request, bootstrap: attribute(html, "data-bootstrap") }),
		});
		const { ceremony, options } = await started.json();
		const credential = await assertion(options.challenge, passkey.keys, {
			handle: null,
		});
		// as PublicKeyCredential.toJSON() writes it, without the key
		delete (credential.response as { userHandle?: unknown }).userHandle;
		const approved = await browser("/oauth/approve", {
			method: "POST",
			headers: { origin },
			body: form({ request, ceremony, credential: JSON.stringify(credential) }),
		});
		expect(approved.status).toBe(303);
		expect(
			new URL(approved.headers.get("location")!).searchParams.get("code"),
		).toBeTruthy();
	});

	test("another user's passkey without a user handle cannot approve an agent", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		await enroll(user);
		const other = await enroll("user-2");
		const html = await consentPage(browser, agent);
		const request = attribute(html, 'name="request" value');
		const started = await browser(attribute(html, "data-endpoint"), {
			method: "POST",
			headers: { origin },
			body: form({ request, bootstrap: attribute(html, "data-bootstrap") }),
		});
		const { ceremony, options } = await started.json();
		const credential = await assertion(options.challenge, other.keys, {
			handle: null,
		});
		const refused = await browser("/oauth/approve", {
			method: "POST",
			headers: { origin },
			body: form({ request, ceremony, credential: JSON.stringify(credential) }),
		});
		expect(refused.status).toBe(400);
		expect(
			await db.sql`SELECT * FROM ${db.auth_tokens} WHERE kind = 'code'`,
		).toEqual([]);
	});

	test("native Deny works after the browser module adds passkey inputs", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const html = await consentPage(browser, agent);
		const response = await browser(attribute(html, "formaction"), {
			method: "POST",
			headers: { origin },
			body: form({
				request: attribute(html, 'name="request" value'),
				credential: "",
				ceremony: "",
			}),
		});
		expect(response.status).toBe(303);
		expect(
			new URL(response.headers.get("location")!).searchParams.get("error"),
		).toBe("access_denied");
	});

	test("a passkey assertion for one grant cannot approve a different client's grant", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const first = await consentPage(browser, agent);
		const second = await consentPage(
			browser,
			"https://agent.example/web.json",
			await Storage.hash("independent-verifier-".repeat(3)),
		);
		const swap: typeof browser = (url, init = {}) => {
			if (url === "/oauth/approve" && init.body instanceof FormData)
				init.body.set("request", attribute(second, 'name="request" value'));
			return browser(url, init);
		};
		await allow(swap, first, await enroll(user));
		expect(
			await db.sql`SELECT client FROM auth_tokens WHERE kind = 'code'`,
		).toEqual([]);
	});

	test("a consent page bootstrap cannot start approval for another client's request", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const shown = await consentPage(browser, agent);
		const other = await consentPage(
			browser,
			"https://agent.example/web.json",
			await Storage.hash("different-verifier-".repeat(3)),
		);
		const request = attribute(other, 'name="request" value');
		const passkey = await enroll(user);
		const started = await browser(attribute(shown, "data-endpoint"), {
			method: "POST",
			headers: { origin },
			body: form({ bootstrap: attribute(shown, "data-bootstrap"), request }),
		});
		if (started.ok) {
			const { ceremony, options } = await started.json();
			const credential = await assertion(options.challenge, passkey.keys, {
				handle: passkey.owner,
			});
			await browser("/oauth/approve", {
				method: "POST",
				headers: { origin },
				body: form({
					request,
					ceremony,
					credential: JSON.stringify(credential),
				}),
			});
		} else {
			expect(started.status).toBeGreaterThanOrEqual(400);
			expect(started.status).toBeLessThan(500);
		}
		expect(
			await db.sql`SELECT client FROM auth_tokens WHERE kind = 'code'`,
		).toEqual([]);
	});

	test.each(["/_passkey/options/approve", "/oauth/approve", "/oauth/deny"])(
		"%s returns a client error for an oversized multipart field count",
		async (path) => {
			const { browser } = agents();
			const response = await browser(path, {
				method: "POST",
				headers: { origin },
				body: form({ a: "1", b: "2", c: "3", d: "4" }),
			});
			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(response.status).toBeLessThan(500);
		},
	);

	test.each(["/_passkey/options/approve", "/oauth/approve", "/oauth/deny"])(
		"%s returns a client error when the multipart boundary is missing",
		async (path) => {
			const { browser } = agents();
			const response = await browser(path, {
				method: "POST",
				headers: { origin, "content-type": "multipart/form-data" },
				body: "invalid multipart body",
			});
			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(response.status).toBeLessThan(500);
		},
	);

	test.each(["/_passkey/options/approve", "/oauth/approve", "/oauth/deny"])(
		"%s returns a client error for an invalid multipart part header",
		async (path) => {
			const { browser } = agents();
			const response = await browser(path, {
				method: "POST",
				headers: {
					origin,
					"content-type": "multipart/form-data; boundary=audit",
				},
				body: '--audit\r\nBad Header: value\r\nContent-Disposition: form-data; name="request"\r\n\r\ninvalid\r\n--audit--\r\n',
			});
			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(response.status).toBeLessThan(500);
		},
	);

	test("sharing Auth across apps mounts OAuth in each app", async () => {
		const { auth } = agents();
		const app = new App().use(auth, new Mcp({ auth }));
		const res = await app.fetch(
			origin + "/.well-known/oauth-authorization-server",
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toHaveProperty("issuer", origin);
	});

	test("retrying an unsupported OAuth mount cannot silently skip the runtime check", () => {
		const { auth } = agents();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Cloudflare-Workers",
		);
		const app = new App().use(auth);
		const mountEndpoint = () => app.use(new Mcp({ auth }));
		expect(mountEndpoint).toThrow(/Node.js or Bun/);
		expect(mountEndpoint).toThrow(/Node.js or Bun/);
	});

	test("denying returns an error to the agent", async () => {
		const { redirect } = await connect("deny");

		expect(redirect.searchParams.get("error")).toBe("access_denied");
		expect(redirect.searchParams.has("code")).toBe(false);
	});

	test("rejects unknown clients, redirects, and resources, and requires PKCE", async () => {
		const { browser } = agents();
		await browser("/sign-in");
		const authorize = (query: Record<string, string>) =>
			browser(`/oauth/authorize?${new URLSearchParams(query)}`);

		// only metadata documents identify agents, by their exact URL
		for (const client_id of [
			"https://evil.example\\@agent.example/client.json",
			"HTTPS://agent.example/client.json",
			"nope",
			"https://agent.example/missing.json",
			"https://agent.example/unsafe.json",
			"https://agent.example/other.json",
			// a document that declares only another way to authenticate, or
			// another grant or response type
			"https://agent.example/key.json",
			"https://agent.example/secret.json",
			"https://agent.example/device.json",
			"https://agent.example/implicit.json",
		])
			expect((await authorize({ client_id })).status).toBe(400);

		// one that declares this server's among others is known
		expect(
			await (
				await authorize({ client_id: "https://agent.example/declared.json" })
			).text(),
		).not.toBe("Unknown client.");

		const web = "https://agent.example/web.json";
		expect(
			(
				await authorize({
					client_id: web,
					redirect_uri: "https://evil.example/cb",
				})
			).status,
		).toBe(400);

		// errors before consent are answered here, never redirected to the
		// client's callback, which would make this origin an open redirector
		const error = async (query: Record<string, string>) => {
			const res = await authorize({ client_id: web, state: "s", ...query });
			expect(res.status).toBe(400);
			expect(res.headers.get("location")).toBeNull();
			return res.text();
		};

		expect(await error({ resource: mcp })).toContain(
			"(unsupported_response_type)",
		);
		expect(await error({ response_type: "code", resource: mcp })).toContain(
			"(invalid_request)",
		);
		expect(
			await error({
				response_type: "code",
				code_challenge: await challenge(),
				code_challenge_method: "S256",
			}),
		).toContain("(invalid_target)");

		// only the mounted MCP endpoint, not any URL on the origin
		for (const other of [`${origin}/notes`, `${mcp}/`, `${mcp}?x=1`])
			expect(
				await error({
					response_type: "code",
					code_challenge: await challenge(),
					code_challenge_method: "S256",
					resource: other,
				}),
			).toContain("(invalid_target)");
	});

	test("a token request that authenticates the client is refused, agents are public clients", async () => {
		const { app } = agents();
		const request = { grant_type: "authorization_code", client_id: agent };

		for (const extra of [
			{ client_secret: "s" },
			{
				client_assertion: "jwt",
				client_assertion_type:
					"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			},
		]) {
			const res = await token(app, { ...request, ...extra });
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ error: "invalid_client" });
		}

		const basic = await app.fetch(`${origin}/oauth/token`, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				authorization: `Basic ${btoa("id:secret")}`,
			},
			body: new URLSearchParams(request),
			ip,
		});
		expect(basic.status).toBe(401);
		expect(basic.headers.get("www-authenticate")).toBe("Basic");
		expect(await basic.json()).toMatchObject({ error: "invalid_client" });

		// without authentication it is the grant that is wrong
		expect(await (await token(app, request)).json()).toMatchObject({
			error: "invalid_grant",
		});
	});

	test("client ID metadata documents", async () => {
		const { browser } = agents();
		await browser("/sign-in");

		const res = await browser(
			`/oauth/authorize?${new URLSearchParams({
				client_id: agent,
				response_type: "code",
				code_challenge: await challenge(),
				code_challenge_method: "S256",
				resource: mcp,
			})}`,
		);
		const page = await browser(res.headers.get("location")!);

		expect(Metadata.fetch).toHaveBeenCalledWith(new URL(agent));
		const html = await page.text();
		expect(html).toContain("Allow Test Agent?");
		expect(html).toContain("127.0.0.1:4000");
	});

	test("agents can connect from Node.js and Bun", async () => {
		for (const [agent, supported] of [
			["Node.js/26", true],
			["Bun/1.4.4", true],
			["Cloudflare-Workers", false],
			["Deno/2.5.0", false],
		] as const) {
			vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
			expect(Metadata.supported).toBe(supported);
			const auth = new Auth({
				secret: "test-secret-with-at-least-32-bytes",
				origin,
				database: db,
				users,
			});
			// passkeys work everywhere, only agents need the safe download
			new App().use(auth);
			const connect = () => new App().use(auth, new Mcp({ auth }));
			if (supported) connect();
			else expect(connect).toThrow(/Node\.js or Bun/);
		}
	});

	test("agents sign in only through an MCP endpoint given auth", async () => {
		const auth = new Auth({
			secret: "test-secret-with-at-least-32-bytes",
			origin,
			database: db,
			users,
		});
		const metadata = `${origin}/.well-known/oauth-authorization-server`;
		const issuer = async (app: App) => (await app.fetch(metadata)).text();

		// unmatched paths have an empty body
		expect(await issuer(new App().use(auth))).toBe("");
		expect(await issuer(new App().use(auth, new Mcp()))).toBe("");

		// two endpoints share one sign-in
		const app = new App().use(
			auth,
			new Mcp({ auth }),
			new Mcp({ auth, path: "/admin/mcp" }),
		);
		expect(JSON.parse(await issuer(app))).toMatchObject({ issuer: origin });
		const authorize = await app.fetch(`${origin}/oauth/authorize`, { ip });
		expect(authorize.status).toBe(400);
	});

	describe("metadata document downloads", () => {
		// a complete request, so a found agent goes on to sign in (303)
		const authorize = async (app: App, client_id: string, from = ip) =>
			app.fetch(
				`${origin}/oauth/authorize?${new URLSearchParams({
					response_type: "code",
					client_id,
					code_challenge: await challenge(),
					code_challenge_method: "S256",
					resource: mcp,
				})}`,
				{ ip: from },
			);

		test("a found agent is kept, and one download is shared", async () => {
			const { app } = agents();

			const [first, second] = await Promise.all([
				authorize(app, agent),
				authorize(app, agent),
			]);
			expect(first.status).toBe(303);
			expect(second.status).toBe(303);
			expect((await authorize(app, agent)).status).toBe(303);
			expect(Metadata.fetch).toHaveBeenCalledTimes(1);

			// an unknown agent is remembered for a minute, not downloaded again
			const now = Date.now();
			const clock = vi.spyOn(Date, "now").mockReturnValue(now);
			try {
				await authorize(app, "https://agent.example/missing.json");
				await authorize(app, "https://agent.example/missing.json");
				expect(Metadata.fetch).toHaveBeenCalledTimes(2);
				clock.mockReturnValue(now + Time.minute + 1);
				await authorize(app, "https://agent.example/missing.json");
				expect(Metadata.fetch).toHaveBeenCalledTimes(3);
			} finally {
				clock.mockRestore();
			}
		});

		test("each IP is limited", async () => {
			const { app } = agents();

			for (let i = 0; i < 30; i++)
				expect((await authorize(app, agent)).status).toBe(303);
			const limited = await authorize(app, agent);
			expect(limited.status).toBe(429);
			expect((await authorize(app, agent, "203.0.113.10")).status).toBe(303);
		});

		test("one client's downloads from a host cannot block the host for others", async () => {
			const { app } = agents();

			// junk client IDs on the real agent's host, from one IP
			for (let i = 0; i < 10; i++)
				expect(
					(
						await authorize(
							app,
							`https://agent.example/${i}.json`,
							"198.51.100.7",
						)
					).status,
				).toBe(400);
			const limited = await authorize(
				app,
				"https://agent.example/10.json",
				"198.51.100.7",
			);
			expect(limited.status).toBe(503);
			expect(Metadata.fetch).toHaveBeenCalledTimes(10);

			// everyone else still connects the real agent from that host
			expect((await authorize(app, agent, "192.0.2.44")).status).toBe(303);
			expect(Metadata.fetch).toHaveBeenCalledTimes(11);
		});

		test("a refused request never refuses another waiting on the same agent", async () => {
			const { app } = agents();

			// one IP spends its downloads from the real agent's host
			for (let i = 0; i < 10; i++)
				await authorize(app, `https://agent.example/${i}.json`, "198.51.100.7");

			// hold its request for the real agent in its own limit check
			const check = Limiter.prototype.check;
			const held = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const spy = vi
				.spyOn(Limiter.prototype, "check")
				.mockImplementation(async function (this: Limiter, c, scope) {
					if (c.ip === "198.51.100.7" && scope === "agent.example") {
						held.resolve();
						await release.promise;
					}
					return check.call(this, c, scope);
				});
			try {
				const refused = authorize(app, agent, "198.51.100.7");
				await held.promise;
				// someone else asks for the same agent meanwhile
				const other = authorize(app, agent, "192.0.2.44");
				await vi.waitFor(() =>
					expect(Metadata.fetch).toHaveBeenCalledTimes(11),
				);
				release.resolve();
				expect((await refused).status).toBe(503);
				expect((await other).status).toBe(303);
			} finally {
				release.resolve();
				spy.mockRestore();
			}
		});

		test("a found agent is served from its last document when downloads are refused", async () => {
			const { app } = agents();
			expect((await authorize(app, agent)).status).toBe(303);
			expect(Metadata.fetch).toHaveBeenCalledTimes(1);

			const now = Date.now();
			const clock = vi.spyOn(Date, "now").mockReturnValue(now);
			const { promise, resolve } = Promise.withResolvers<void>();
			try {
				// its cache ran out, and every download slot is taken
				clock.mockReturnValue(now + 5 * Time.minute + 1);
				vi.mocked(Metadata.fetch).mockImplementation(async (url) => {
					await promise;
					return documents[url.href];
				});
				const waiting = Array.from({ length: 16 }, (_, i) =>
					authorize(
						app,
						`https://agent${i}.example/client.json`,
						`198.51.100.${i}`,
					),
				);
				await vi.waitFor(() =>
					expect(Metadata.fetch).toHaveBeenCalledTimes(17),
				);

				expect((await authorize(app, agent, "192.0.2.44")).status).toBe(303);
				expect(Metadata.fetch).toHaveBeenCalledTimes(17);

				// an hour later its document is too old to use
				clock.mockReturnValue(now + Time.hour + 1);
				expect((await authorize(app, agent, "192.0.2.45")).status).toBe(503);

				resolve();
				await Promise.all(waiting);
			} finally {
				resolve();
				clock.mockRestore();
			}
		});

		test("a failure that may pass serves a found agent, a final one forgets it", async () => {
			const { app } = agents();
			expect((await authorize(app, agent)).status).toBe(303);

			const now = Date.now();
			const clock = vi.spyOn(Date, "now").mockReturnValue(now);
			try {
				// its host times out
				clock.mockReturnValue(now + 5 * Time.minute + 1);
				vi.mocked(Metadata.fetch).mockResolvedValue(null);
				expect((await authorize(app, agent)).status).toBe(303);
				expect(Metadata.fetch).toHaveBeenCalledTimes(2);

				// its document is gone
				vi.mocked(Metadata.fetch).mockResolvedValue(undefined);
				expect((await authorize(app, agent)).status).toBe(400);
				expect(Metadata.fetch).toHaveBeenCalledTimes(3);

				// and stays forgotten through an outage
				clock.mockReturnValue(now + 7 * Time.minute);
				vi.mocked(Metadata.fetch).mockResolvedValue(null);
				expect((await authorize(app, agent)).status).toBe(503);
			} finally {
				clock.mockRestore();
			}
		});

		test("rotating IPv6 addresses in one /64 cannot take extra download slots", async () => {
			const { app } = agents();
			const release = Promise.withResolvers<void>();
			vi.mocked(Metadata.fetch).mockImplementation(async (url) => {
				if (url.href !== agent) await release.promise;
				return documents[url.href];
			});
			const waiting = [1, 2].map((i) =>
				authorize(
					app,
					`https://slow${i}.example/client.json`,
					`2001:db8:1::${i}`,
				),
			);
			try {
				await vi.waitFor(() => expect(Metadata.fetch).toHaveBeenCalledTimes(2));
				expect((await authorize(app, agent, "2001:db8:1::3")).status).toBe(503);
				expect(Metadata.fetch).toHaveBeenCalledTimes(2);
			} finally {
				release.resolve();
				await Promise.all(waiting);
			}
		});

		test("one IP holds at most two downloads at once", async () => {
			const { app } = agents();
			const { promise, resolve } = Promise.withResolvers<void>();
			vi.mocked(Metadata.fetch).mockImplementation(async (url) => {
				await promise;
				return documents[url.href];
			});

			const slow = [0, 1].map((i) =>
				authorize(app, `https://agent${i}.example/client.json`, "198.51.100.7"),
			);
			await vi.waitFor(() => expect(Metadata.fetch).toHaveBeenCalledTimes(2));
			const third = await authorize(
				app,
				"https://agent2.example/client.json",
				"198.51.100.7",
			);
			expect(third.status).toBe(503);

			// another IP is not held up
			const other = authorize(app, agent, "192.0.2.44");
			await vi.waitFor(() => expect(Metadata.fetch).toHaveBeenCalledTimes(3));
			resolve();
			expect((await other).status).toBe(303);
			await Promise.all(slow);
		});

		test("downloads at once are limited", async () => {
			const { app } = agents();
			const { promise, resolve } = Promise.withResolvers<void>();
			vi.mocked(Metadata.fetch).mockImplementation(async (url) => {
				await promise;
				return documents[url.href];
			});

			const waiting = Array.from({ length: 16 }, (_, i) =>
				authorize(
					app,
					`https://agent${i}.example/client.json`,
					`198.51.100.${i}`,
				),
			);
			await vi.waitFor(() => expect(Metadata.fetch).toHaveBeenCalledTimes(16));

			const limited = await authorize(app, agent, "198.51.100.16");
			expect(limited.status).toBe(503);

			resolve();
			for (const res of await Promise.all(waiting))
				expect(res.status).toBe(400);
			expect((await authorize(app, agent, "198.51.100.16")).status).toBe(303);
		});
	});
});
