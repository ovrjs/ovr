import { Schema } from "../schema/index.js";
import { Database } from "./index.js";
import { PGlite } from "@electric-sql/pglite";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

describe("database audit regressions", () => {
	let engine: PGlite;
	let scanned = 0;
	const query = async (text: string, values?: unknown[]) => {
		const result = values?.length
			? await engine.query(text, values)
			: { rows: (await engine.exec(text)).at(-1)?.rows ?? [] };

		if (/\bFROM\s+ovr_migrations\b/i.test(text)) scanned += result.rows.length;

		return result;
	};
	const pool: Database.Pool = {
		query,
		connect: async () => ({ query, release() {} }),
	};
	const db = new Database(pool, []);

	beforeAll(async () => {
		engine = await PGlite.create();
	});

	afterAll(async () => {
		await engine?.close();
	});

	beforeEach(async () => {
		await pool.query("DROP TABLE IF EXISTS entries, ovr_migrations CASCADE");
		scanned = 0;
	});

	test("a caught database error cannot report a rolled-back transaction as successful", async () => {
		await db.sql`CREATE TABLE entries (id integer)`;

		await expect(
			db.transaction(async (t) => {
				await t.sql`INSERT INTO entries VALUES (1)`;
				try {
					await t.sql`SELECT 1 / 0`;
				} catch {
					// Catching the statement error does not restore the transaction.
				}
				return "saved";
			}),
		).rejects.toThrow();
		expect(await db.sql`SELECT * FROM entries`).toEqual([]);
	});

	test("a lazy query cannot execute after its transaction releases the connection", async () => {
		await db.sql`CREATE TABLE entries (id integer)`;
		const result = await db.transaction(async (t) => ({
			query: t.sql`INSERT INTO entries VALUES (1)`,
		}));

		await expect(result.query).rejects.toThrow();
		expect(await db.sql`SELECT * FROM entries`).toEqual([]);
	});

	test("an escaped transaction tag cannot execute inside a later transaction", async () => {
		await db.sql`CREATE TABLE entries (id integer)`;
		const sql = await db.transaction(async (t) => t.sql);

		await db.transaction(async () => {
			await expect(sql`INSERT INTO entries VALUES (1)`).rejects.toThrow();
		});
		expect(await db.sql`SELECT * FROM entries`).toEqual([]);
	});

	test("decoding an integer as a number cannot silently lose precision", async () => {
		await expect(
			db.sql`SELECT 9007199254740993::bigint AS id`.parse(
				Schema.object({ id: Schema.number() }),
			),
		).rejects.toThrow();
	});

	test("driver decoding does not coerce invalid values inside JSON columns", async () => {
		await expect(
			db.sql`SELECT '{"count":"1"}'::jsonb AS metadata`.parse(
				Schema.object({ metadata: Schema.object({ count: Schema.number() }) }),
			),
		).rejects.toThrow(Schema.AggregateIssue);
	});

	test("migration history work scales linearly when bootstrapping a database", async () => {
		const migrations = Array.from({ length: 32 }, (_, i) => ({
			id: String(i).padStart(4, "0"),
			sql: "SELECT 1",
		}));

		expect(await db.migrate(migrations)).toHaveLength(migrations.length);
		// Allow several complete reads, but not 1 + 2 + ... + N history rows.
		expect(scanned).toBeLessThanOrEqual(migrations.length * 4);
	});
});
