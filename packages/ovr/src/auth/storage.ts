import type { Database } from "../database/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Time } from "../util/index.js";
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
	static readonly credentials = new Table("ovr_credentials", {
		id: Schema.string(),
		user: Schema.string(),
		publicKey: Schema.string(),
		counter: Schema.number().int(),
		eligible: Schema.boolean(),
		backedUp: Schema.boolean(),
	});

	/** Revocable sessions. */
	static readonly sessions = new Table("ovr_sessions", {
		id: Schema.string(),
		user: Schema.string(),
		expiration: Schema.number().int(),
	});

	/** Outstanding WebAuthn ceremonies. */
	static readonly challenges = new Table("ovr_challenges", {
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
	}

	readonly challenges: Storage.Challenges = {
		set: async (id, challenge) => {
			await this.#prune();

			const table = Storage.challenges;
			const now = Date.now();

			return this.#db.transaction(async (t) => {
				// one writer at a time, so concurrent requests cannot share the last
				// slot; the insert's snapshot is taken after the lock
				await t.sql`SELECT pg_advisory_xact_lock(hashtext('ovr_challenges'))`;

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
