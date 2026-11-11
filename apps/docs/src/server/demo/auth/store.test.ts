import { type Store, migrations, open, users } from "./store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Auth } from "ovr";
import { afterEach, describe, expect, test } from "vitest";

const stores: Store[] = [];
const folders: string[] = [];

afterEach(async () => {
	for (const store of stores.splice(0)) await store.close();
	for (const folder of folders.splice(0))
		rmSync(folder, { recursive: true, force: true });
});

describe("demo database", () => {
	// it starts a database twice, which takes seconds when other tests run
	test(
		"applies its migration, matches its tables, and persists across restarts",
		{ timeout: 30_000 },
		async () => {
			const folder = mkdtempSync(join(tmpdir(), "ovr-auth-"));
			folders.push(folder);

			const first = await open(folder);
			const id = crypto.randomUUID();
			await first.sql`INSERT INTO ${users} ${first.sql.values(users, { id, email: "a@example.com" })}`;
			await first.close();

			const second = await open(folder);
			stores.push(second);
			expect(await second.migrate(migrations)).toEqual([]);
			// Auth tells the check which users table its tables reference
			new Auth({
				secret: "test-secret-with-at-least-32-bytes",
				origin: "https://localhost:5173",
				database: second,
				users,
			});
			expect(await second.check()).toEqual([]);
			expect(
				await second.sql`SELECT * FROM ${second.users}`.parse(users),
			).toEqual([{ id, email: "a@example.com" }]);
		},
	);

	test("deleting an account removes its credentials, sessions, and agents' tokens", async () => {
		const database = await open("memory://");
		stores.push(database);
		const id = crypto.randomUUID();
		await database.sql(async (t) => {
			await t.sql`INSERT INTO ${users} ${t.sql.values(users, { id, email: "a@example.com" })}`;
			await t.sql`INSERT INTO ${database.auth_credentials} ${t.sql.values(database.auth_credentials, { id: "c", user: id, publicKey: "k", counter: 0, eligible: false, backedUp: false })}`;
			await t.sql`INSERT INTO ${database.auth_sessions} ${t.sql.values(database.auth_sessions, { id: "s", user: id, expiration: Date.now() + 60000, started: Date.now() })}`;
			await t.sql`INSERT INTO ${database.auth_tokens} ${t.sql.values(database.auth_tokens, { id: "t", kind: "access", user: id, client: "https://agent.example/client.json", resource: "https://localhost:5173/mcp", scope: "", redirect: null, challenge: null, family: "t", expiration: Date.now() + 60000 })}`;
		});
		await database.sql`DELETE FROM ${users}`;
		expect(
			await database.sql`SELECT * FROM ${database.auth_credentials}`,
		).toEqual([]);
		expect(await database.sql`SELECT * FROM ${database.auth_sessions}`).toEqual(
			[],
		);
		expect(await database.sql`SELECT * FROM ${database.auth_tokens}`).toEqual(
			[],
		);
	});
});
