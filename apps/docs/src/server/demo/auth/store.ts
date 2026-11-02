import { PGlite } from "@electric-sql/pglite";
import { Auth, Database, Schema, Table } from "ovr";

/** Demo accounts; Auth stores credentials and sessions in its own tables. */
export const users = new Table("users", {
	id: Schema.string().uuid(),
	email: Schema.string().email(),
});

/** Migrations an application keeps as SQL files. */
export const migrations: Database.Migration[] = [
	{
		id: "0001_auth",
		sql: `
			CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL);

			CREATE TABLE ovr_credentials (
				id text PRIMARY KEY,
				"user" uuid NOT NULL REFERENCES users ON DELETE CASCADE,
				"publicKey" text NOT NULL,
				counter bigint NOT NULL,
				eligible boolean NOT NULL,
				"backedUp" boolean NOT NULL
			);
			CREATE INDEX ovr_credentials_user ON ovr_credentials ("user");

			CREATE TABLE ovr_sessions (
				id text PRIMARY KEY,
				"user" uuid NOT NULL REFERENCES users ON DELETE CASCADE,
				expiration bigint NOT NULL
			);
			CREATE INDEX ovr_sessions_expiration ON ovr_sessions (expiration);

			CREATE TABLE ovr_challenges (
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
			CREATE INDEX ovr_challenges_expiration ON ovr_challenges (expiration);
			CREATE INDEX ovr_challenges_browser ON ovr_challenges (browser, expiration);

			CREATE TABLE ovr_limits (
				key text PRIMARY KEY,
				tokens double precision NOT NULL,
				time bigint NOT NULL,
				expiration bigint NOT NULL
			);
			CREATE INDEX ovr_limits_expiration ON ovr_limits (expiration);
		`,
	},
];

/**
 * Open the demo's PGlite database, applying migrations. Applications pass a
 * `pg` Pool to `Database` instead.
 *
 * @param path Data directory, or `memory://` for a temporary database
 * @returns Database with the demo's tables
 */
export async function open(path = ".auth-pglite"): Promise<Store> {
	const engine = await PGlite.create(path);
	// PGlite has one session, so a transaction holds it until released
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

	await db.migrate(migrations);

	const differences = await db.check();
	if (differences.length)
		throw new Error(
			`Database does not match its tables:\n${differences.join("\n")}`,
		);

	return Object.assign(db, { close: () => engine.close() });
}

/** The demo database, closed when the dev server stops. */
export type Store = Database<readonly [typeof users, ...typeof Auth.tables]> & {
	close(): Promise<void>;
};
