import { App } from "../app/index.js";
import { Database } from "../database/index.js";
import { Field } from "../form/index.js";
import { Mcp } from "../mcp/index.js";
import { Route } from "../route/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Tester } from "../test/index.js";
import { Auth } from "./index.js";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, expect, test } from "vitest";

const origin = "https://example.com";

const engine = await PGlite.create();
let turn = Promise.resolve();
const acquire = () => {
	let release!: () => void;
	const previous = turn;
	turn = new Promise((resolve) => (release = resolve));
	return previous.then(() => release);
};
const run = async (text: string, values?: unknown[]) =>
	values?.length
		? engine.query(text, values)
		: ((await engine.exec(text)).at(-1) ?? { rows: [] });
const users = new Table("users", { id: Schema.string(), email: Field.email() });
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
const database = new Database(pool, [users, ...Auth.tables]);
await database.migrate([
	{
		id: "0001_users",
		sql: "CREATE TABLE users (id text PRIMARY KEY, email text NOT NULL)",
	},
]);

/**
 * @param id Passkey's ID
 * @param user Whose it is
 * @param created When it was made
 * @param more Its name, and where it was made
 */
const passkey = (
	id: string,
	user: string,
	created: number,
	more: { name?: string; origin?: string; backedUp?: boolean } = {},
) =>
	database.sql`
		INSERT INTO ${database.auth_credentials}
		${database.sql.values(database.auth_credentials, {
			id,
			user,
			publicKey: "key",
			counter: 0,
			eligible: true,
			backedUp: more.backedUp ?? false,
			created,
			origin: more.origin ?? origin,
			name: more.name ?? null,
		})}
	`;

beforeEach(async () => {
	await engine.exec(
		"TRUNCATE users, auth_credentials, auth_sessions, auth_challenges, rate_limits, auth_tokens, auth_links",
	);
	await engine.exec(
		"INSERT INTO users VALUES ('ross', 'ross@example.com'), ('sam', 'sam@example.com')",
	);
	// out of order, and one that is someone else's
	await passkey("laptop", "ross", 200, { name: "Laptop", backedUp: true });
	await passkey("first", "ross", 100, { origin: "https://localhost:5173" });
	await passkey("sams", "sam", 150);
});
afterAll(() => engine.close());

function setup() {
	const auth = new Auth({ secret: "s".repeat(32), origin, database, users });
	const list = Route.get("/passkeys").use(async (c) =>
		c.json(await auth.passkeys(c)),
	);
	const remove = Route.post("/passkeys/remove")
		.describe("Remove a passkey")
		.fields({ id: Field.hidden() })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return c.redirect(result.url, 303);
			return c.json({ removed: await auth.remove(c, result.data.id) });
		});
	const agents = Route.get("/agents").use(async (c) =>
		c.json(await auth.agents(c)),
	);
	const app = new App().use(auth, new Mcp({ auth }), list, remove, agents);

	return { app, list, remove, agents };
}

test("lists the signed-in user's passkeys, oldest first", async () => {
	const { app, list } = setup();
	const ross = new Tester({ app, user: "ross" });

	expect(await (await ross.fetch(list)).json()).toEqual([
		{
			id: "first",
			name: null,
			created: 100,
			origin: "https://localhost:5173",
			synced: false,
		},
		{ id: "laptop", name: "Laptop", created: 200, origin, synced: true },
	]);
});

test("removes a passkey, never the last and never someone else's", async () => {
	const { app, list, remove } = setup();
	const ross = new Tester({ app, user: "ross" });
	const removed = async (id: string) =>
		(
			(await (await ross.fetch(remove, { data: { id } })).json()) as {
				removed: boolean;
			}
		).removed;
	const left = async (tester: Tester) =>
		((await (await tester.fetch(list)).json()) as Auth.Passkey[]).map(
			(one) => one.id,
		);

	expect(await removed("sams")).toBe(false);
	expect(await removed("missing")).toBe(false);
	expect(await removed("first")).toBe(true);
	expect(await left(ross)).toEqual(["laptop"]);
	// nothing else signs in as them
	expect(await removed("laptop")).toBe(false);
	expect(await left(ross)).toEqual(["laptop"]);
	expect(await left(new Tester({ app, user: "sam" }))).toEqual(["sams"]);
});

test("removing a passkey signs the user out everywhere else, agents too", async () => {
	const { app, list, remove, agents } = setup();
	const laptop = new Tester({ app, user: "ross" });
	const lost = new Tester({ app, user: "ross" });
	const sam = new Tester({ app, user: "sam" });
	await lost.fetch(list);
	await sam.fetch(list);

	// an agent on the lost device cannot remove one
	await expect(lost.call(remove, { id: "laptop" })).rejects.toThrow(
		"An agent cannot remove a passkey",
	);
	expect(await (await laptop.fetch(agents)).json()).toHaveLength(1);

	await laptop.fetch(remove, { data: { id: "first" } });

	await expect(lost.fetch(list)).rejects.toThrow("Sign in to list passkeys");
	expect(await (await laptop.fetch(list)).json()).toHaveLength(1);
	expect(await (await laptop.fetch(agents)).json()).toEqual([]);
	expect(await (await sam.fetch(list)).json()).toHaveLength(1);
});

test("two removals at once leave one passkey", async () => {
	const { app, list, remove } = setup();
	const ross = new Tester({ app, user: "ross" });
	// signed in before the two requests, which then share its cookie
	await ross.fetch(list);

	const results = await Promise.all(
		["first", "laptop"].map(async (id) =>
			(await ross.fetch(remove, { data: { id } })).json(),
		),
	);

	expect(
		results.filter((result) => (result as { removed: boolean }).removed),
	).toHaveLength(1);
	expect(await (await ross.fetch(list)).json()).toHaveLength(1);
});

test("need someone signed in", async () => {
	const { app, list, remove } = setup();
	const visitor = new Tester({ app });

	await expect(visitor.fetch(list)).rejects.toThrow("Sign in to list passkeys");
	await expect(
		visitor.fetch(remove, { data: { id: "first" } }),
	).rejects.toThrow("Sign in to remove a passkey");
});
