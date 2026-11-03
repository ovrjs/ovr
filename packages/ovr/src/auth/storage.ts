import type { Database } from "../database/index.js";
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

	/** Revocable sessions shared by all instances. */
	export interface Sessions {
		set(id: string, session: Auth.Session): Result<void>;
		/** Return a session, or nothing if it has expired or been revoked. */
		get(id: string): Result<Auth.Session | null | undefined>;
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
		/** Save `credential` only if the record still matches `previous`. */
		update(
			credential: Auth.Credential,
			previous: Auth.Credential,
		): Result<boolean>;
	}
}

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

	/** Outstanding ceremonies across all browsers, and for one browser. */
	static readonly #capacity = { total: 10000, browser: 10 };

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

			return this.#db.transaction(async (t) => {
				const [found] = await t.sql`
					SELECT * FROM ${Storage.tokens} WHERE id = ${id}
				`.parse(Storage.tokens);
				if (!found) return false;
				const { family } = found;

				// one exchange per family at a time, so a revocation waits for tokens
				// being issued and its snapshot, taken after the lock, includes them
				await t.sql`SELECT pg_advisory_xact_lock(hashtext('auth_tokens'), hashtext(${family}))`;

				const [row] = await t.sql`
					UPDATE ${Storage.tokens} SET kind = 'spent'
					WHERE id = ${id} AND kind = ${kind}
					RETURNING *
				`.parse(Storage.tokens);

				if (!row) {
					// stolen and used by someone else, so neither party keeps access
					await t.sql`
						DELETE FROM ${Storage.tokens} WHERE family = ${family} AND EXISTS (
							SELECT 1 FROM ${Storage.tokens} WHERE id = ${id} AND kind = 'spent'
						)
					`;
					return false;
				}

				const used = Storage.#token([{ ...row, kind }]);
				const issued = used && (await exchange(used));
				if (!issued) return false;

				for (const [value, issue] of Object.entries(issued))
					await this.#insert(t.sql, value, { ...issue, family: row.family });

				return true;
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

			return this.#db.transaction(async (t) => {
				// one writer at a time, so concurrent requests cannot share the last
				// slot; the insert's snapshot is taken after the lock
				await t.sql`SELECT pg_advisory_xact_lock(hashtext('auth_challenges'))`;

				const rows = await t.sql`
					INSERT INTO ${table} (id, challenge, browser, method, action, origin, expiration, "user", fields)
					SELECT ${id}, ${challenge.challenge}, ${challenge.browser}, ${challenge.method},
						${challenge.action}, ${challenge.origin}, ${challenge.expiration}::bigint,
						${challenge.user ?? null}, ${challenge.fields ?? null}
					WHERE NOT EXISTS (
						SELECT 1 FROM ${table} WHERE expiration > ${now} OFFSET ${Storage.#capacity.total - 1}
					) AND (
						SELECT count(*) FROM ${table} WHERE browser = ${challenge.browser} AND expiration > ${now}
					) < ${Storage.#capacity.browser}
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
		return this.#db.transaction(async (t) => {
			await create(t, credential.user);
			await t.sql`
				INSERT INTO ${Storage.credentials} ${t.sql.values(Storage.credentials, credential)}
			`;
		});
	}
}
