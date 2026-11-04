import { type Store, migrations, open, users } from "./store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const stores: Store[] = [];
const folders: string[] = [];

afterEach(async () => {
	for (const store of stores.splice(0)) await store.close();
	for (const folder of folders.splice(0))
		rmSync(folder, { recursive: true, force: true });
});

describe("demo database", () => {
	test("applies its migration, matches its tables, and persists across restarts", async () => {
		const folder = mkdtempSync(join(tmpdir(), "ovr-auth-"));
		folders.push(folder);

		const first = await open(folder);
		const id = crypto.randomUUID();
		await first.sql`INSERT INTO ${users} ${first.sql.values(users, { id, email: "a@example.com" })}`;
		await first.close();

		const second = await open(folder);
		stores.push(second);
		expect(await second.migrate(migrations)).toEqual([]);
		expect(await second.check()).toEqual([]);
		expect(
			await second.sql`SELECT * FROM ${second.users}`.parse(users),
		).toEqual([{ id, email: "a@example.com" }]);
	});

	test("deleting an account removes its credentials and sessions", async () => {
		const database = await open("memory://");
		stores.push(database);
		const id = crypto.randomUUID();
		await database.sql(async (t) => {
			await t.sql`INSERT INTO ${users} ${t.sql.values(users, { id, email: "a@example.com" })}`;
			await t.sql`INSERT INTO ${database.auth_credentials} ${t.sql.values(database.auth_credentials, { id: "c", user: id, publicKey: "k", counter: 0, eligible: false, backedUp: false })}`;
			await t.sql`INSERT INTO ${database.auth_sessions} ${t.sql.values(database.auth_sessions, { id: "s", user: id, expiration: Date.now() + 60000 })}`;
		});
		await database.sql`DELETE FROM ${users}`;
		expect(
			await database.sql`SELECT * FROM ${database.auth_credentials}`,
		).toEqual([]);
		expect(await database.sql`SELECT * FROM ${database.auth_sessions}`).toEqual(
			[],
		);
	});
});
