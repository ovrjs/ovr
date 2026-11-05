import {
	type Database,
	owned,
	referenced,
	references,
} from "../database/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Codec, Time } from "../util/index.js";
import type { Auth } from "./index.js";

type Result<T> = T | Promise<T>;

export namespace Storage {
	/** Server-side state for one WebAuthn ceremony. */
	export interface Challenge {
		readonly challenge: string;
		readonly browser: string;
		readonly method: "register" | "login";
		readonly action: string;
		readonly origin: string;
		readonly expiration: number;
		readonly user?: string;
		/** SHA-256 base64url digest binding validated registration fields to the provider label. */
		readonly fields?: string;
	}

	/** Single-use challenges shared by all instances. */
	export interface Challenges {
		/** Store until expiration. Return false when capacity is exhausted. */
		set(id: string, challenge: Challenge): Result<void | boolean>;
		/** Atomically return and delete an entry; concurrent calls have one winner. */
		take(id: string): Result<Challenge | null | undefined>;
	}

	/** A stored session, with the time it started for its lifetime. */
	export interface Session extends Auth.Session {
		/** Sign-in time in milliseconds. */
		readonly started: number;
	}

	/** Revocable sessions shared by all instances. */
	export interface Sessions {
		set(id: string, session: Session): Result<void>;
		/** Return a session, or nothing if it has expired or been revoked. */
		get(id: string): Result<Session | null | undefined>;
		/** Move a session's expiration later, never earlier. */
		renew(id: string, expiration: number): Result<void>;
		delete(id: string): Result<void>;
	}

	/** OAuth client registered by an agent. */
	/** OAuth authorization code or token, stored by its hash. */
	export interface Token {
		readonly kind: "code" | "access" | "refresh";
		readonly user: string;
		readonly client: string;
		readonly resource: string;
		readonly scope: string;
		readonly expiration: number;
		readonly redirect?: string;
		readonly challenge?: string;
		/** Hash of the code the token descends from, defaults to its own */
		readonly family?: string;
	}

	/** Credential lookup and compare-and-swap updates. */
	export interface Credentials {
		get(id: string): Result<Auth.Credential | null | undefined>;
		/** IDs of the user's credentials */
		list(user: string): Result<readonly string[]>;
		/** Save `credential` only if the record still matches `previous`. */
		update(
			credential: Auth.Credential,
			previous: Auth.Credential,
		): Result<boolean>;
	}
}

/** An exchange refused after it started writing, rolled back. */
class Refused extends Error {}

/** Authentication persistence in the application's Postgres database. */
export class Storage {
	/** Registered passkeys. */
	static readonly credentials = new Table("auth_credentials", {
		id: Schema.string(),
		user: Schema.string(),
		publicKey: Schema.string(),
		counter: Schema.number().int(),
		eligible: Schema.boolean(),
		backedUp: Schema.boolean(),
	});

	/** Revocable sessions. */
	static readonly sessions = new Table("auth_sessions", {
		id: Schema.string(),
		user: Schema.string(),
		expiration: Schema.number().int(),
		started: Schema.number().int(),
	});

	/** Outstanding WebAuthn ceremonies. */
	static readonly challenges = new Table("auth_challenges", {
		id: Schema.string(),
		challenge: Schema.string(),
		browser: Schema.string(),
		method: Schema.enum(["register", "login"]),
		action: Schema.string(),
		origin: Schema.string(),
		expiration: Schema.number().int(),
		user: Schema.string().nullable(),
		fields: Schema.string().nullable(),
	});

	/** Authorization codes, access tokens, and refresh tokens, by hash. */
	static readonly tokens = new Table("auth_tokens", {
		id: Schema.string(),
		// a used code or refresh token is kept as "spent" to detect replays
		kind: Schema.enum(["code", "access", "refresh", "spent"]),
		user: Schema.string(),
		client: Schema.string(),
		resource: Schema.string(),
		scope: Schema.string(),
		redirect: Schema.string().nullable(),
		challenge: Schema.string().nullable(),
		family: Schema.string(),
		expiration: Schema.number().int(),
	});

	/**
	 * Migrations creating Auth's tables, by version. A version never changes,
	 * so its checksum stays valid; later changes ship as new versions.
	 * `database.migrate` applies them for a database with `Auth.tables`. User IDs
	 * are text, so they hold any ID `auth.login` accepts.
	 */
	static readonly #migrations = [
		{
			id: "auth:1",
			sql: `CREATE TABLE auth_credentials (
	id text PRIMARY KEY,
	"user" text NOT NULL,
	"publicKey" text NOT NULL,
	counter bigint NOT NULL,
	eligible boolean NOT NULL,
	"backedUp" boolean NOT NULL
);
CREATE INDEX auth_credentials_user ON auth_credentials ("user");

CREATE TABLE auth_sessions (
	id text PRIMARY KEY,
	"user" text NOT NULL,
	started bigint NOT NULL,
	expiration bigint NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions ("user");
CREATE INDEX auth_sessions_expiration ON auth_sessions (expiration);

CREATE TABLE auth_challenges (
	id text PRIMARY KEY,
	challenge text NOT NULL,
	browser text NOT NULL,
	method text NOT NULL,
	action text NOT NULL,
	origin text NOT NULL,
	expiration bigint NOT NULL,
	"user" text,
	fields text
);
CREATE INDEX auth_challenges_expiration ON auth_challenges (expiration);
CREATE INDEX auth_challenges_browser ON auth_challenges (browser, expiration);

CREATE TABLE auth_tokens (
	id text PRIMARY KEY,
	kind text NOT NULL,
	"user" text NOT NULL,
	client text NOT NULL,
	resource text NOT NULL,
	scope text NOT NULL,
	redirect text,
	challenge text,
	family text NOT NULL,
	expiration bigint NOT NULL
);
CREATE INDEX auth_tokens_family ON auth_tokens (family);
CREATE INDEX auth_tokens_user ON auth_tokens ("user");
CREATE INDEX auth_tokens_expiration ON auth_tokens (expiration);`,
		},
	] as const;

	static {
		for (const table of [
			Storage.credentials,
			Storage.sessions,
			Storage.challenges,
			Storage.tokens,
		])
			owned.set(table, Storage.#migrations);

		// deleting an account deletes what signs in as it, `database.check` verifies it
		for (const table of [Storage.credentials, Storage.sessions, Storage.tokens])
			referenced.set(table, { column: "user", by: "Auth" });
	}

	/** Tables whose rows belong to a user, and must reference the users table. */
	static readonly owners = [
		Storage.credentials,
		Storage.sessions,
		Storage.tokens,
	] as const;

	/**
	 * Outstanding ceremonies for one browser. There is no cap across browsers:
	 * cookies are free to mint, so any cap shared by all of them is one
	 * attacker's to fill, and the per-IP limit already bounds each network.
	 */
	static readonly #capacity = 10;

	/** One store per database, so instances share pruning. */
	static readonly #stores = new WeakMap<Database, Storage>();

	readonly #db: Database;
	#pruned = 0;

	/**
	 * @param db Database containing the authentication tables
	 */
	constructor(db: Database) {
		this.#db = db;
	}

	/**
	 * @param db Database containing the authentication tables
	 * @returns The database's store
	 */
	static of(db: Database) {
		return Storage.#stores.getOrInsertComputed(db, () => new Storage(db));
	}

	/** Remove expired sessions and challenges, at most once a minute. */
	async #prune() {
		const now = Date.now();

		// either direction, so a clock moving back cannot stop pruning
		if (Math.abs(now - this.#pruned) < Time.minute) return;

		this.#pruned = now;
		await this.#db
			.sql`DELETE FROM ${Storage.challenges} WHERE expiration <= ${now}`;
		await this.#db
			.sql`DELETE FROM ${Storage.sessions} WHERE expiration <= ${now}`;
		if (this.#oauth)
			await this.#db
				.sql`DELETE FROM ${Storage.tokens} WHERE expiration <= ${now}`;
	}

	/** OAuth tables are in use, so their rows are pruned too */
	#oauth = false;

	/**
	 * @param token Code or token
	 * @returns SHA-256 hash to store it by
	 */
	static async hash(token: string) {
		return Codec.Base64Url.encode(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", Codec.encode(token)),
			),
		);
	}

	readonly tokens = {
		/**
		 * @param token Code or token, stored by its hash
		 * @param row Token data
		 */
		set: async (token: string, row: Storage.Token) => {
			this.#oauth = true;
			await this.#prune();
			await this.#insert(this.#db.sql, token, row);
		},
		/**
		 * Uses a code or refresh token once, in one transaction with the tokens
		 * it is exchanged for. Replaying a used one revokes its whole family.
		 *
		 * @param token Code or refresh token
		 * @param kind Kind of token
		 * @param exchange Checks the unexpired token, returns the tokens to issue in its family, or `undefined` to refuse
		 * @returns `true` if the tokens were issued
		 */
		exchange: async (
			token: string,
			kind: "code" | "refresh",
			exchange: (
				row: Storage.Token,
			) => Promise<Record<string, Storage.Token> | undefined>,
		) => {
			this.#oauth = true;
			await this.#prune();
			const id = await Storage.hash(token);

			return this.#db
				.sql(async (t) => {
					const [found] = await t.sql`
						SELECT * FROM ${Storage.tokens} WHERE id = ${id}
					`.parse(Storage.tokens);
					if (!found) return false;

					// one exchange per user at a time, so a replay or a disconnection
					// waits for tokens being issued, and its snapshot, taken after the
					// lock, includes them
					await Storage.#lock(t.sql, found.user);
					if (!(await this.#account(t.sql, found.user))) return false;

					// read again under the lock, an exchange before it may have used it
					const [row] = await t.sql`
						SELECT * FROM ${Storage.tokens} WHERE id = ${id}
					`.parse(Storage.tokens);
					if (!row) return false;

					if (row.kind !== kind) {
						// stolen and used by someone else, so neither party keeps access
						if (row.kind === "spent")
							await t.sql`DELETE FROM ${Storage.tokens} WHERE family = ${row.family}`;
						return false;
					}

					const used = Storage.#token([row]);
					const issued = used && (await exchange(used));
					if (!issued) return false;

					for (const [value, issue] of Object.entries(issued))
						await this.#insert(t.sql, value, { ...issue, family: row.family });

					// kept as long as what it was exchanged for, so replaying it later
					// still finds the family and revokes it
					const until = Math.max(
						row.expiration,
						...Object.values(issued).map((issue) => issue.expiration),
					);
					const spent = await t.sql`
						UPDATE ${Storage.tokens} SET kind = 'spent', expiration = ${until}
						WHERE id = ${id} AND kind = ${kind}
						RETURNING id
					`;
					// deleted meanwhile, outside Auth, so nothing is issued
					if (!spent.length) throw new Refused();

					return true;
				})
				.catch((error: unknown) => {
					if (
						error instanceof Refused ||
						// the account was deleted meanwhile, its tokens cascade with it
						(error as { code?: unknown } | null)?.code === "23503"
					)
						return false;
					throw error;
				});
		},
		/**
		 * Disconnect one of a user's agents: its codes, access tokens, and
		 * refresh tokens, including ones an exchange is issuing at the same time.
		 *
		 * @param user User ID
		 * @param client Agent's client ID
		 */
		revoke: async (user: string, client: string) => {
			await this.#db.sql(async (t) => {
				// waits for an exchange issuing this user's tokens, so the delete sees them
				await Storage.#lock(t.sql, user);
				await this.#account(t.sql, user);
				await t.sql`
					DELETE FROM ${Storage.tokens}
					WHERE ${Storage.tokens.columns.user} = ${user}
						AND ${Storage.tokens.columns.client} = ${client}
				`;
			});
		},
		/**
		 * @param token Access token
		 * @returns The unexpired token
		 */
		get: async (token: string) =>
			Storage.#token(
				await this.#db.sql`
					SELECT * FROM ${Storage.tokens}
					WHERE id = ${await Storage.hash(token)} AND kind = 'access'
				`.parse(Storage.tokens),
			),
	};

	/**
	 * Lock the account's row before any of its tokens, the order deleting the
	 * account takes them in, so the two wait for each other instead of
	 * deadlocking, whenever the foreign key is checked. The users table is the
	 * one `new Auth()` registered for this database.
	 *
	 * @param sql Transaction's SQL tag
	 * @param user User ID
	 * @returns `false` when the account no longer exists
	 */
	async #account(sql: Database.Tag, user: string) {
		const users = references.get(this.#db)?.get(Storage.tokens);
		if (!users) return true;

		const rows = await sql`
			SELECT 1 FROM ${users} WHERE ${users.columns.id} = ${user} FOR KEY SHARE
		`;

		return rows.length > 0;
	}

	/**
	 * Serialize issuing and revoking a user's tokens, until the transaction ends.
	 *
	 * @param sql Transaction's SQL tag
	 * @param user User ID
	 */
	static async #lock(sql: Database.Tag, user: string) {
		await sql`SELECT pg_advisory_xact_lock(hashtext('auth_tokens'), hashtext(${user}))`;
	}

	/**
	 * @param sql SQL tag to insert with
	 * @param token Code or token, stored by its hash
	 * @param row Token data
	 */
	async #insert(sql: Database.Tag, token: string, row: Storage.Token) {
		const id = await Storage.hash(token);
		await sql`
			INSERT INTO ${Storage.tokens} ${sql.values(Storage.tokens, {
				redirect: null,
				challenge: null,
				...row,
				family: row.family ?? id,
				id,
			})}
		`;
	}

	/**
	 * @param rows Token rows
	 * @returns The first row unless it has expired
	 */
	static #token([row]: Table.Row<(typeof Storage.tokens)["shape"]>[]) {
		if (!row || row.expiration <= Date.now()) return;
		const { redirect, challenge, kind, ...token } = row;
		return {
			...token,
			kind: kind as Storage.Token["kind"],
			...(redirect === null ? {} : { redirect }),
			...(challenge === null ? {} : { challenge }),
		};
	}

	readonly challenges: Storage.Challenges = {
		set: async (id, challenge) => {
			await this.#prune();

			const table = Storage.challenges;
			const now = Date.now();

			return this.#db.sql(async (t) => {
				// one writer at a time for each browser, so its concurrent requests
				// cannot share the last slot; the insert's snapshot is taken after the lock
				await t.sql`SELECT pg_advisory_xact_lock(hashtext('auth_challenges'), hashtext(${challenge.browser}))`;

				const rows = await t.sql`
					INSERT INTO ${table} (id, challenge, browser, method, action, origin, expiration, "user", fields)
					SELECT ${id}, ${challenge.challenge}, ${challenge.browser}, ${challenge.method},
						${challenge.action}, ${challenge.origin}, ${challenge.expiration}::bigint,
						${challenge.user ?? null}, ${challenge.fields ?? null}
					WHERE (
						SELECT count(*) FROM ${table} WHERE browser = ${challenge.browser} AND expiration > ${now}
					) < ${Storage.#capacity}
					RETURNING id
				`;

				return rows.length === 1;
			});
		},
		take: async (id) => {
			const [row] = await this.#db.sql`
				DELETE FROM ${Storage.challenges} WHERE id = ${id} RETURNING *
			`.parse(Storage.challenges);

			if (!row) return;

			const { id: _, user, fields, ...challenge } = row;

			return {
				...challenge,
				...(user === null ? {} : { user }),
				...(fields === null ? {} : { fields }),
			};
		},
	};

	readonly sessions: Storage.Sessions = {
		set: async (_, session) => {
			await this.#prune();
			await this.#db.sql`
				INSERT INTO ${Storage.sessions} ${this.#db.sql.values(Storage.sessions, session)}
			`;
		},
		get: async (id) =>
			(
				await this.#db.sql`
					SELECT * FROM ${Storage.sessions} WHERE id = ${id} AND expiration > ${Date.now()}
				`.parse(Storage.sessions)
			)[0],
		renew: async (id, expiration) => {
			const { columns } = Storage.sessions;
			await this.#db.sql`
				UPDATE ${Storage.sessions} SET ${this.#db.sql.set(Storage.sessions, { expiration })}
				WHERE ${columns.id} = ${id} AND ${columns.expiration} < ${expiration}
			`;
		},
		delete: async (id) => {
			await this.#db.sql`DELETE FROM ${Storage.sessions} WHERE id = ${id}`;
		},
	};

	readonly credentials: Storage.Credentials = {
		get: async (id) =>
			(
				await this.#db.sql`
					SELECT * FROM ${Storage.credentials} WHERE id = ${id}
				`.parse(Storage.credentials)
			)[0],
		list: async (user) => {
			const { columns } = Storage.credentials;
			const rows = await this.#db.sql`
				SELECT ${columns.id} FROM ${Storage.credentials} WHERE ${columns.user} = ${user}
			`.parse(Schema.object({ id: Schema.string() }));
			return rows.map((row) => row.id);
		},
		update: async (credential, previous) => {
			const { columns } = Storage.credentials;
			const rows = await this.#db.sql`
				UPDATE ${Storage.credentials}
				SET ${this.#db.sql.set(Storage.credentials, {
					counter: credential.counter,
					backedUp: credential.backedUp,
				})}
				WHERE ${columns.id} = ${previous.id} AND ${columns.user} = ${previous.user}
					AND ${columns.publicKey} = ${previous.publicKey} AND ${columns.counter} = ${previous.counter}
					AND ${columns.eligible} = ${previous.eligible} AND ${columns.backedUp} = ${previous.backedUp}
				RETURNING id
			`;

			return rows.length === 1;
		},
	};

	/**
	 * Create the account and its first credential in one transaction.
	 *
	 * @param create Application callback creating the account
	 * @param credential Verified credential
	 */
	register(
		create: (t: Database.Transaction, user: string) => Result<void>,
		credential: Auth.Credential,
	) {
		return this.#db.sql(async (t) => {
			await create(t, credential.user);
			await t.sql`
				INSERT INTO ${Storage.credentials} ${t.sql.values(Storage.credentials, credential)}
			`;
		});
	}
}
