import { DatabaseSync } from "node:sqlite";
import { type Auth, type Limiter, Schema } from "ovr";

/** SQLite persistence for the authentication demo. */
export class Store {
	static readonly #user = Schema.object({
		id: Schema.string(),
		email: Schema.string(),
	});
	static readonly #credential = Schema.object({
		id: Schema.string(),
		user: Schema.string(),
		publicKey: Schema.string(),
		counter: Schema.number().int(),
		eligible: Schema.union([Schema.literal(0), Schema.literal(1)]).transform(
			Boolean,
		),
		backedUp: Schema.union([Schema.literal(0), Schema.literal(1)]).transform(
			Boolean,
		),
	});
	static readonly #session = Schema.object({
		id: Schema.string(),
		user: Schema.string(),
		expiration: Schema.number().int(),
	});
	static readonly #limit = Schema.object({
		tokens: Schema.number(),
		time: Schema.number().int(),
	});
	static readonly #challenge = Schema.object({
		payload: Schema.string().json(
			Schema.object({
				challenge: Schema.string(),
				browser: Schema.string(),
				method: Schema.union([
					Schema.literal("register"),
					Schema.literal("login"),
				]),
				action: Schema.string(),
				origin: Schema.string(),
				expiration: Schema.number().int(),
				user: Schema.string().optional(),
				fields: Schema.string().optional(),
			}),
		),
	});
	readonly #db: DatabaseSync;
	readonly #sql;
	#pruned = 0;

	/** Open a persistent database, creating the demo schema if necessary. */
	constructor(path = ".auth.sqlite") {
		this.#db = new DatabaseSync(path);
		this.#db.exec(`
			PRAGMA foreign_keys = ON;
			PRAGMA busy_timeout = 5000;
			PRAGMA journal_mode = WAL;
			CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY, email TEXT NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS credentials (
				id TEXT PRIMARY KEY,
				user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				publicKey TEXT NOT NULL,
				counter INTEGER NOT NULL CHECK(counter BETWEEN 0 AND 4294967295),
				eligible INTEGER NOT NULL CHECK(eligible IN (0, 1)),
				backedUp INTEGER NOT NULL CHECK(backedUp IN (0, 1) AND backedUp <= eligible)
			) STRICT;
			CREATE INDEX IF NOT EXISTS credentials_user ON credentials(user);
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expiration INTEGER NOT NULL
			) STRICT;
			CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expiration);
			CREATE TABLE IF NOT EXISTS challenges (
				id TEXT PRIMARY KEY, payload TEXT NOT NULL, expiration INTEGER NOT NULL
			) STRICT;
			CREATE INDEX IF NOT EXISTS challenges_expiration ON challenges(expiration);
			CREATE TABLE IF NOT EXISTS limits (
				key TEXT PRIMARY KEY, tokens REAL NOT NULL, time INTEGER NOT NULL, expiration INTEGER NOT NULL
			) STRICT;
			CREATE INDEX IF NOT EXISTS limits_expiration ON limits(expiration);
		`);
		// Preserve sessions in databases created by the earlier demo.
		const legacy = this.#db.prepare(
			"SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'token'",
		);
		if (legacy.get()) {
			this.#db.exec("BEGIN IMMEDIATE");
			try {
				if (legacy.get())
					this.#db.exec(`
						ALTER TABLE sessions RENAME COLUMN id TO user;
						ALTER TABLE sessions RENAME COLUMN token TO id;
					`);
				this.#db.exec("COMMIT");
			} catch (error) {
				this.#db.exec("ROLLBACK");
				throw error;
			}
		}
		this.#sql = {
			limit: this.#db.prepare(
				"SELECT tokens, time FROM limits WHERE key = ? AND expiration > ?",
			),
			capacity: this.#db.prepare(
				"SELECT 1 FROM limits WHERE expiration > ? LIMIT 1 OFFSET 9999",
			),
			consume: this.#db.prepare(
				"INSERT INTO limits (key, tokens, time, expiration) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET tokens = excluded.tokens, time = excluded.time, expiration = excluded.expiration",
			),
			challenge: this.#db.prepare(
				`
				INSERT INTO challenges (id, payload, expiration)
				SELECT ?, ?, ? WHERE
				(SELECT count(*) FROM challenges WHERE expiration > ?) < 1000 AND
				(SELECT count(*) FROM challenges WHERE expiration > ? AND json_extract(payload, '$.browser') = ?) < 10
			`,
			),
			take: this.#db.prepare(
				"DELETE FROM challenges WHERE id = ? RETURNING payload",
			),
			session: this.#db.prepare(
				"INSERT INTO sessions (id, user, expiration) VALUES (?, ?, ?)",
			),
			read: this.#db.prepare(
				"SELECT id, user, expiration FROM sessions WHERE id = ? AND expiration > ?",
			),
			delete: this.#db.prepare("DELETE FROM sessions WHERE id = ?"),
			credential: this.#db.prepare("SELECT * FROM credentials WHERE id = ?"),
			update: this.#db.prepare(
				`
				UPDATE credentials SET counter = ?, backedUp = ?
				WHERE id = ? AND user = ? AND publicKey = ? AND counter = ? AND eligible = ? AND backedUp = ?
			`,
			),
			user: this.#db.prepare("SELECT id, email FROM users WHERE id = ?"),
			list: this.#db.prepare(
				"SELECT * FROM credentials WHERE user = ? ORDER BY id",
			),
			register: this.#db.prepare("INSERT INTO users (id, email) VALUES (?, ?)"),
			insert: this.#db.prepare(
				"INSERT INTO credentials (id, user, publicKey, counter, eligible, backedUp) VALUES (?, ?, ?, ?, ?, ?)",
			),
			sessions: this.#db.prepare("DELETE FROM sessions WHERE expiration <= ?"),
			challenges: this.#db.prepare(
				"DELETE FROM challenges WHERE expiration <= ?",
			),
			limits: this.#db.prepare("DELETE FROM limits WHERE expiration <= ?"),
		};
		this.prune();
	}

	static #parse<T>(schema: Schema<T>, row: unknown) {
		if (row === undefined) return;
		const result = schema.parse(row);
		if (result.issues) throw result;
		return result.data;
	}

	/** Share ovr's token-bucket policies across processes using one atomic transaction. */
	readonly consume = (
		key: string,
		{ limit, interval }: Limiter.Policy,
	): true | number => {
		const now = Date.now();
		if (now - this.#pruned >= 60000) this.prune(now);
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const previous = Store.#parse(
				Store.#limit,
				this.#sql.limit.get(key, now),
			);
			if (!previous && this.#sql.capacity.get(now))
				// Evicting a live bucket would restore its burst and let rotating clients bypass quotas.
				throw new Error("Rate limit storage capacity exhausted");
			const tokens = previous
				? Math.min(
						limit,
						previous.tokens +
							(Math.max(0, now - previous.time) * limit) / interval,
					)
				: limit;
			if (tokens < 1) {
				this.#db.exec("COMMIT");
				return (
					now + Math.max(1000, Math.ceil(((1 - tokens) * interval) / limit))
				);
			}
			this.#sql.consume.run(
				key,
				tokens - 1,
				previous ? Math.max(now, previous.time) : now,
				now + interval,
			);
			this.#db.exec("COMMIT");
			return true;
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	};

	/** Atomic single-use challenge storage. */
	readonly challenges: Auth.Challenges = {
		set: (id, value) => {
			if (Date.now() - this.#pruned >= 60000) this.prune();
			// One statement bounds shared outstanding storage, including concurrent instances.
			return (
				this.#sql.challenge.run(
					id,
					JSON.stringify(value),
					value.expiration,
					Date.now(),
					Date.now(),
					value.browser,
				).changes === 1
			);
		},
		take: (id) => {
			// One statement consumes the record across every connection to this database.
			const value = Store.#parse(
				Store.#challenge,
				this.#sql.take.get(id),
			)?.payload;
			return value && value.expiration > Date.now() ? value : undefined;
		},
	};

	/** Persistent sessions; deleted and expired sessions cannot authenticate. */
	readonly sessions: Auth.Sessions = {
		set: (id, value) => {
			if (id !== value.id) throw new TypeError("Session ID mismatch");
			if (Date.now() - this.#pruned >= 60000) this.prune();
			this.#sql.session.run(id, value.user, value.expiration);
		},
		get: (id) =>
			Store.#parse(Store.#session, this.#sql.read.get(id, Date.now())),
		delete: (id) => {
			this.#sql.delete.run(id);
		},
	};

	/** Credential lookup and compare-and-swap updates, without recreating deleted records. */
	readonly credentials: Auth.Credentials = {
		get: (id) => Store.#parse(Store.#credential, this.#sql.credential.get(id)),
		update: (next, previous) => {
			if (
				next.id !== previous.id ||
				next.user !== previous.user ||
				next.publicKey !== previous.publicKey ||
				next.eligible !== previous.eligible
			)
				return false;
			return (
				this.#sql.update.run(
					next.counter,
					Number(next.backedUp),
					previous.id,
					previous.user,
					previous.publicKey,
					previous.counter,
					Number(previous.eligible),
					Number(previous.backedUp),
				).changes === 1
			);
		},
	};

	/** Read an account. */
	user(id: string) {
		return Store.#parse(Store.#user, this.#sql.user.get(id));
	}

	/** List an account's registered passkeys. */
	list(user: string) {
		return this.#sql.list
			.all(user)
			.map((row) => Store.#parse(Store.#credential, row)!);
	}

	/** Create a new account and its first credential in one transaction. */
	register(credential: Auth.Credential, email: string) {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			this.#sql.register.run(credential.user, email);
			this.#sql.insert.run(
				credential.id,
				credential.user,
				credential.publicKey,
				credential.counter,
				Number(credential.eligible),
				Number(credential.backedUp),
			);
			this.#db.exec("COMMIT");
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}

	/** Remove expired sessions and unconsumed challenges; called on startup and writes. */
	prune(now = Date.now()) {
		this.#pruned = now;
		this.#sql.sessions.run(now);
		this.#sql.challenges.run(now);
		this.#sql.limits.run(now);
	}

	/** Close the database connection. */
	close() {
		this.#db.close();
	}
}
