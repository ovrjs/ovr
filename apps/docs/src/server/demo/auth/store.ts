import { PGlite } from "@electric-sql/pglite";
import { Auth, Database, Field, Schema, Table } from "ovr";

/** Demo accounts; Auth stores credentials and sessions in its own tables. */
export const users = new Table("users", {
	id: Schema.string().uuid(),
	email: Field.email({ label: "Email" }),
});

/** Migrations an application keeps as SQL files, applied after Auth's own. */
export const migrations: Database.Migration[] = [
	{
		id: "0001_users",
		// text, like Auth's user IDs, so Auth's tables can reference it
		sql: "CREATE TABLE users (id text PRIMARY KEY, email text NOT NULL);",
	},
	{
		id: "0002_auth_users",
		sql: `
			ALTER TABLE auth_credentials ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
			ALTER TABLE auth_sessions ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
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
