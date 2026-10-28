import { DatabaseSync } from "node:sqlite";
import { type Auth, Schema } from "ovr";

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
		token: Schema.string(),
		expiration: Schema.number().int(),
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
			}),
		),
	});
	readonly #db: DatabaseSync;

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
				token TEXT PRIMARY KEY,
				id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expiration INTEGER NOT NULL
			) STRICT;
			CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expiration);
			CREATE TABLE IF NOT EXISTS challenges (
				id TEXT PRIMARY KEY, payload TEXT NOT NULL, expiration INTEGER NOT NULL
			) STRICT;
			CREATE INDEX IF NOT EXISTS challenges_expiration ON challenges(expiration);
		`);
		this.prune();
	}

	static #parse<T>(schema: Schema<T>, row: unknown) {
		if (row === undefined) return;
		const result = schema.parse(row);
		if (result.issues) throw result;
		return result.data;
	}

	/** Atomic single-use challenge storage. */
	readonly challenges: Auth.Challenges = {
		set: (id, value) => {
			this.prune();
			this.#db
				.prepare(
					"INSERT INTO challenges (id, payload, expiration) VALUES (?, ?, ?)",
				)
				.run(id, JSON.stringify(value), value.expiration);
		},
		take: (id) => {
			// One statement consumes the record across every connection to this database.
			const value = Store.#parse(
				Store.#challenge,
				this.#db
					.prepare("DELETE FROM challenges WHERE id = ? RETURNING payload")
					.get(id),
			)?.payload;
			return value && value.expiration > Date.now() ? value : undefined;
		},
	};

	/** Persistent sessions; deleted and expired sessions cannot authenticate. */
	readonly sessions: Auth.Sessions = {
		set: (token, value) => {
			if (token !== value.token) throw new TypeError("Session token mismatch");
			this.prune();
			this.#db
				.prepare(
					"INSERT INTO sessions (token, id, expiration) VALUES (?, ?, ?)",
				)
				.run(token, value.id, value.expiration);
		},
		get: (token) =>
			Store.#parse(
				Store.#session,
				this.#db
					.prepare(
						"SELECT token, id, expiration FROM sessions WHERE token = ? AND expiration > ?",
					)
					.get(token, Date.now()),
			),
		delete: (token) => {
			this.#db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
		},
	};

	/** Credential lookup and compare-and-swap updates, without recreating deleted records. */
	readonly credentials: Auth.Credentials = {
		find: (id) =>
			Store.#parse(
				Store.#credential,
				this.#db.prepare("SELECT * FROM credentials WHERE id = ?").get(id),
			),
		update: (next, previous) => {
			if (
				next.id !== previous.id ||
				next.user !== previous.user ||
				next.publicKey !== previous.publicKey ||
				next.eligible !== previous.eligible
			)
				return false;
			return (
				this.#db
					.prepare(
						`
				UPDATE credentials SET counter = ?, backedUp = ?
				WHERE id = ? AND user = ? AND publicKey = ? AND counter = ? AND eligible = ? AND backedUp = ?
			`,
					)
					.run(
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

	/** Authentication configuration using this database for all transient auth state. */
	options(secret: string, origin = "https://localhost:5173"): Auth.Options {
		return {
			secret,
			origin,
			name: "ovr demo",
			challenges: this.challenges,
			sessions: this.sessions,
		};
	}

	/** Read an account. */
	user(id: string) {
		return Store.#parse(
			Store.#user,
			this.#db.prepare("SELECT id, email FROM users WHERE id = ?").get(id),
		);
	}

	/** List an account's registered passkeys. */
	list(user: string) {
		return this.#db
			.prepare("SELECT * FROM credentials WHERE user = ? ORDER BY id")
			.all(user)
			.map((row) => Store.#parse(Store.#credential, row)!);
	}

	/** Create a new account and its first credential in one transaction. */
	register(credential: Auth.Credential, email: string) {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			this.#db
				.prepare("INSERT INTO users (id, email) VALUES (?, ?)")
				.run(credential.user, email);
			this.#db
				.prepare(
					"INSERT INTO credentials (id, user, publicKey, counter, eligible, backedUp) VALUES (?, ?, ?, ?, ?, ?)",
				)
				.run(
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
		this.#db.prepare("DELETE FROM sessions WHERE expiration <= ?").run(now);
		this.#db.prepare("DELETE FROM challenges WHERE expiration <= ?").run(now);
	}

	/** Close the database connection. */
	close() {
		this.#db.close();
	}
}
