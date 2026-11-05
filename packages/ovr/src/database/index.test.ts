import { Field, Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Database } from "./index.js";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

const users = new Table(
	"users",
	{
		id: Schema.string().uuid(),
		email: Schema.string().email(),
		name: Schema.string().nullable(),
		visits: Schema.bigint(),
		created: Schema.date(),
		meta: Schema.object({ theme: Schema.string() }),
		tags: Schema.array(Schema.string()),
	},
	{ default: ["id", "created"] },
);

const posts = new Table(
	"posts",
	{
		id: Schema.number().int(),
		author: Schema.string().uuid(),
		title: Schema.string().min(1),
		published: Schema.boolean(),
	},
	{ default: ["published"] },
);

const init = `
	CREATE TABLE users (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		email text NOT NULL UNIQUE,
		name text,
		visits bigint NOT NULL,
		created timestamptz NOT NULL DEFAULT now(),
		meta jsonb NOT NULL,
		tags jsonb NOT NULL
	);
	CREATE TABLE posts (
		id integer PRIMARY KEY,
		author uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		title text NOT NULL,
		published boolean NOT NULL DEFAULT false
	);
	CREATE INDEX ON posts (author);
`;

/** Records queries and which checked-out client ran them. */
const mock = (fail?: (text: string) => boolean) => {
	const log: string[] = [];
	const released: unknown[] = [];
	let clients = 0;
	const query = (id: string) => async (text: string, values?: unknown[]) => {
		log.push(
			`${id}: ${text}${values?.length ? ` ${JSON.stringify(values)}` : ""}`,
		);
		if (fail?.(text)) throw new Error(`failed ${text}`);
		return { rows: [] };
	};
	const pool: Database.Pool = {
		query: query("pool"),
		connect: async () => {
			const id = `client${++clients}`;
			return {
				query: query(id),
				release: (error?: Error | boolean) => void released.push(error),
			};
		},
	};

	return { pool, log, released };
};

describe("sql", () => {
	const db = new Database(mock().pool, [users, posts]);

	test("binds values and quotes tables and columns", () => {
		const weird = new Table('we"ird', { n: Schema.bigint() });
		const fragment = db.sql`SELECT * FROM ${db.users} WHERE ${db.users.columns.email} = ${"a'b"} AND ${weird.columns.n} > ${1n}`;

		expect(fragment.toQuery()).toEqual({
			text: 'SELECT * FROM "users" WHERE "users"."email" = $1 AND "we""ird"."n" > $2',
			values: ["a'b", "1"],
		});
	});

	test("qualifies tables with a schema", () => {
		const table = new Table(
			"events",
			{ id: Schema.string() },
			{ schema: "app" },
		);

		expect(db.sql`SELECT * FROM ${table}`.toQuery().text).toBe(
			'SELECT * FROM "app"."events"',
		);
	});

	test("nests fragments and renumbers parameters", () => {
		const filter = db.sql`AND b = ${2} AND c = ${db.sql`${3} + ${4}`}`;

		expect(db.sql`SELECT ${0} WHERE a = ${1} ${filter}`.toQuery()).toEqual({
			text: "SELECT $1 WHERE a = $2 AND b = $3 AND c = $4 + $5",
			values: [0, 1, 2, 3, 4],
		});
		expect(db.sql`WHERE true${db.sql``}`.toQuery().text).toBe("WHERE true");
	});

	test("never interpolates values as SQL", () => {
		const evil = "x'); DROP TABLE users; --";

		expect(db.sql`SELECT ${evil}`.toQuery()).toEqual({
			text: "SELECT $1",
			values: [evil],
		});
		const nul = new Table("a\0b", { n: Schema.bigint() });
		expect(() => db.sql`SELECT * FROM ${nul}`.toQuery()).toThrow(TypeError);
	});

	test("values validates rows and uses DEFAULT for omitted columns", () => {
		const id = crypto.randomUUID();
		const fragment = db.sql.values(db.users, [
			{
				email: "a@example.com",
				visits: 1n,
				meta: { theme: "dark" },
				tags: ["x"],
			},
			{
				id,
				email: "b@example.com",
				name: "B",
				visits: 2n,
				meta: { theme: "" },
				tags: [],
			},
		]);

		expect(fragment.toQuery()).toEqual({
			text: '("id", "email", "name", "visits", "meta", "tags") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4), ($5, $6, $7, $8, $9, $10)',
			values: [
				"a@example.com",
				"1",
				'{"theme":"dark"}',
				'["x"]',
				id,
				"b@example.com",
				"B",
				"2",
				'{"theme":""}',
				"[]",
			],
		});
	});

	test("values rejects invalid, missing, and unknown columns", () => {
		const issues = (fn: () => unknown) => {
			try {
				fn();
			} catch (error) {
				return (error as Schema.Parse.Invalid).issues.map((i) => i.path);
			}
			throw new Error("Expected issues");
		};

		expect(
			issues(() =>
				db.sql.values(db.users, [
					{ email: "nope", visits: 1n, meta: { theme: "" }, tags: [] },
				]),
			),
		).toEqual([[0, "email"]]);
		expect(
			issues(() =>
				db.sql.values(db.users, {
					email: "a@example.com",
					meta: { theme: "" },
					tags: [],
				} as never),
			),
		).toEqual([["visits"]]);
		expect(issues(() => db.sql.set(db.users, { nope: 1 } as never))).toEqual([
			["nope"],
		]);
	});

	test("values accepts any array of rows, and rejects an empty one", () => {
		const rows: { id: number; author: string; title: string }[] = [
			{ id: 1, author: crypto.randomUUID(), title: "One" },
		];

		expect(db.sql.values(db.posts, rows).toQuery().values).toHaveLength(3);
		expect(() => db.sql.values(db.posts, [])).toThrow("requires a row");
	});

	test("values with only defaults", () => {
		const table = new Table("t", { id: Schema.string() }, { default: ["id"] });

		expect(db.sql.values(table, {}).toQuery().text).toBe("DEFAULT VALUES");
		expect(() => db.sql.values(table, [{}, {}])).toThrow(TypeError);
	});

	test("unknown columns must be given unless they have a default", () => {
		const table = new Table("t", {
			data: Schema.unknown(),
			extra: Schema.unknown().nullable(),
		});

		expect(() =>
			// @ts-expect-error unknown columns are required
			db.sql.values(table, {}),
		).toThrow(Schema.AggregateIssue);
		expect(
			db.sql.values(table, { data: null, extra: null }).toQuery().values,
		).toEqual(["null", null]);
		expect(
			db.sql
				.values(
					new Table("t", { data: Schema.unknown() }, { default: ["data"] }),
					{},
				)
				.toQuery().text,
		).toBe("DEFAULT VALUES");
	});

	test("JSON null is SQL NULL only in nullable columns", () => {
		const table = new Table("t", {
			data: Schema.unknown(),
			extra: Schema.unknown().nullable(),
		});

		expect(
			db.sql.set(table, { data: null, extra: null }).toQuery().values,
		).toEqual(["null", null]);
	});

	test("set validates supplied columns only", () => {
		expect(db.sql.set(db.users, { name: null, tags: ["a"] }).toQuery()).toEqual(
			{ text: '"name" = $1, "tags" = $2', values: [null, '["a"]'] },
		);
		expect(() => db.sql.set(db.users, {})).toThrow(TypeError);
	});

	test("runs once when awaited, like a promise", async () => {
		const { pool, log } = mock();
		const db = new Database(pool, [users]);
		const condition = db.sql`${db.users.columns.name} IS NULL`;
		const query = db.sql`SELECT * FROM ${db.users} WHERE ${condition}`;

		expect(log).toEqual([]);
		expect(Object.prototype.toString.call(query)).toBe("[object Sql]");

		await query;
		await query;
		await query.finally(() => {});
		await query.catch(() => {});
		await Promise.all([query]);

		expect(log).toEqual([
			`pool: SELECT * FROM "users" WHERE "users"."name" IS NULL`,
		]);
	});

	test("parse shares the query's single run", async () => {
		const { pool, log } = mock();
		const db = new Database(pool, []);
		const query = db.sql`INSERT INTO t DEFAULT VALUES RETURNING *`;
		const row = Schema.object({});

		await query;
		await query.parse(row);
		await query.parse(row).parse(row);

		expect(log).toEqual(["pool: INSERT INTO t DEFAULT VALUES RETURNING *"]);
	});

	test("catch and finally receive the outcome", async () => {
		const { pool } = mock(() => true);
		const db = new Database(pool, []);
		let settled = false;

		const error = await db.sql`SELECT 1`
			.finally(() => {
				settled = true;
			})
			.catch((e: unknown) => e);

		expect(settled).toBe(true);
		expect(error).toBeInstanceOf(Error);
		expect(await db.sql`SELECT 1`.catch(() => "caught")).toBe("caught");
	});

	test("rejects reserved and duplicate table names", () => {
		const sql = new Table("sql", { id: Schema.string() });

		expect(
			// @ts-expect-error reserved table names are a type error
			() => new Database(mock().pool, [sql]),
		).toThrow(TypeError);
		expect(() => new Database(mock().pool, [users, users])).toThrow(TypeError);
	});
});

describe("sql(fn)", () => {
	test("runs on one client and commits", async () => {
		const { pool, log, released } = mock();
		const db = new Database(pool, []);

		const result = await db.sql(async (t) => {
			await t.sql`SELECT ${1}`;
			await t.sql`SELECT ${2}`;
			return "done";
		});

		expect(result).toBe("done");
		expect(log).toEqual([
			"client1: BEGIN",
			"client1: SELECT $1 [1]",
			"client1: SELECT $1 [2]",
			"client1: COMMIT",
		]);
		expect(released).toEqual([undefined]);
	});

	test("rolls back and rethrows the original error", async () => {
		const { pool, log, released } = mock();
		const db = new Database(pool, []);
		const error = new Error("boom");

		await expect(
			db.sql(async (t) => {
				await t.sql`SELECT 1`;
				throw error;
			}),
		).rejects.toBe(error);
		expect(log).toEqual([
			"client1: BEGIN",
			"client1: SELECT 1",
			"client1: ROLLBACK",
		]);
		expect(released).toEqual([undefined]);
	});

	test("destroys a client that cannot roll back", async () => {
		const { pool, released } = mock((text) => text === "ROLLBACK");
		const db = new Database(pool, []);
		const error = new Error("boom");

		await expect(
			db.sql(async () => {
				throw error;
			}),
		).rejects.toBe(error);
		expect(released[0]).toBeInstanceOf(Error);
	});

	test("a failed commit rolls back and releases", async () => {
		const { pool, log, released } = mock((text) => text === "COMMIT");
		const db = new Database(pool, []);

		await expect(db.sql(async () => 1)).rejects.toThrow("failed COMMIT");
		expect(log.at(-1)).toBe("client1: ROLLBACK");
		expect(released).toEqual([undefined]);
	});

	test("transactions do not nest", async () => {
		const { pool, log } = mock();
		const db = new Database(pool, []);

		await expect(
			db.sql(async (t) => {
				// @ts-expect-error t.sql only runs queries
				await t.sql(async () => {});
			}),
		).rejects.toThrow("template tag");
		expect(log).toEqual(["client1: BEGIN", "client1: ROLLBACK"]);
	});

	test("rejects calls that are not a template or a callback", () => {
		const db = new Database(mock().pool, []);

		// @ts-expect-error A string would be sent as SQL without parameters.
		expect(() => db.sql("SELECT 1")).toThrow("template tag");
	});
});

/** Integration drivers; real Postgres runs when OVR_TEST_DATABASE_URL is a disposable database. */
const drivers: {
	name: string;
	/** If failing queries leave the connection usable. */
	errors: boolean;
	start(): Promise<{ pool: Database.Pool; stop(): Promise<void> }>;
}[] = [
	{
		name: "pglite",
		errors: true,
		async start() {
			const pglite = await PGlite.create();
			// exec runs several statements, its last result is the query's
			const query = async (text: string, values?: unknown[]) =>
				values?.length
					? pglite.query(text, values)
					: ((await pglite.exec(text)).at(-1) ?? { rows: [] });

			return {
				pool: { query, connect: async () => ({ query, release() {} }) },
				stop: () => pglite.close(),
			};
		},
	},
	{
		// PGlite's socket server resets a connection after a query error, so error paths run on the other drivers
		name: "pg",
		errors: false,
		async start() {
			const pglite = await PGlite.create();
			const port = 40000 + Math.floor(Math.random() * 20000);
			const server = new PGLiteSocketServer({ db: pglite, port });
			await server.start();
			// one backend, so one connection keeps sessions honest
			const pool = new pg.Pool({
				connectionString: `postgres://postgres@127.0.0.1:${port}/postgres`,
				max: 1,
			});

			return {
				pool,
				async stop() {
					await pool.end();
					await server.stop();
					await pglite.close();
				},
			};
		},
	},
	...(process.env.OVR_TEST_DATABASE_URL
		? [
				{
					name: "postgres",
					errors: true,
					async start() {
						const schema = `ovr_test_${crypto.randomUUID().replaceAll("-", "")}`;
						const pool = new pg.Pool({
							connectionString: process.env.OVR_TEST_DATABASE_URL,
							options: `-c search_path=${schema}`,
						});
						await pool.query(`CREATE SCHEMA ${schema}`);

						return {
							pool,
							async stop() {
								await pool.query(`DROP SCHEMA ${schema} CASCADE`);
								await pool.end();
							},
						};
					},
				},
			]
		: []),
];

describe.each(drivers)("$name", (driver) => {
	let pool: Database.Pool;
	let stop: () => Promise<void>;
	let db: Database<[typeof users, typeof posts]>;

	beforeAll(async () => {
		({ pool, stop } = await driver.start());
		db = new Database(pool, [users, posts]);
	});

	afterAll(() => stop());

	beforeEach(async () => {
		await pool.query(
			"DROP TABLE IF EXISTS posts, users, migrations, other CASCADE",
		);
	});

	const migrate = () => db.migrate([{ id: "0001_init", sql: init }]);

	test("dates inside a JSON column are stored as ISO strings and read back as dates", async () => {
		const events = new Table("events", {
			id: Schema.number().int(),
			meta: Schema.object({
				at: Schema.date(),
				times: Schema.array(Schema.date()),
			}),
		});
		const database = new Database(pool, [events]);
		await database.sql`CREATE TABLE events (id integer PRIMARY KEY, meta jsonb NOT NULL)`;
		try {
			const at = new Date("2026-11-04T12:00:00.000Z");
			await database.sql`INSERT INTO ${events} ${database.sql.values(events, {
				id: 1,
				meta: { at, times: [at] },
			})}`;
			const [row] = await database.sql`SELECT * FROM ${events}`.parse(events);
			expect(row!.meta.at).toEqual(at);
			expect(row!.meta.times[0]).toEqual(at);
			expect(
				await database.sql`SELECT meta ->> 'at' AS at FROM ${events}`,
			).toEqual([{ at: "2026-11-04T12:00:00.000Z" }]);
		} finally {
			await database.sql`DROP TABLE events`;
		}
	});

	test("migrate applies once", async () => {
		expect(await migrate()).toEqual(["0001_init"]);
		expect(await migrate()).toEqual([]);
		expect(await db.check()).toEqual([]);
	});

	test("round trips rows", async () => {
		await migrate();

		const [user] = await db.sql`
			INSERT INTO ${db.users} ${db.sql.values(db.users, {
				email: "ross@example.com",
				visits: 9007199254740993n,
				meta: { theme: "dark" },
				tags: ["a", "b"],
			})}
			RETURNING *
		`.parse(db.users);

		expect(user).toMatchObject({
			email: "ross@example.com",
			name: null,
			visits: 9007199254740993n,
			meta: { theme: "dark" },
			tags: ["a", "b"],
		});
		expect(user!.id).toMatch(/^[\da-f-]{36}$/);
		expect(user!.created).toBeInstanceOf(Date);

		await db.sql`INSERT INTO ${db.posts} ${db.sql.values(db.posts, [
			{ id: 1, author: user!.id, title: "One" },
			{ id: 2, author: user!.id, title: "Two", published: true },
		])}`;

		const [updated] = await db.sql`
			UPDATE ${db.users} SET ${db.sql.set(db.users, { name: "Ross" })}
			WHERE ${db.users.columns.id} = ${user!.id}
			RETURNING *
		`.parse(db.users);

		expect(updated!.name).toBe("Ross");

		const feed = await db.sql`
			SELECT p.title, u.name FROM ${db.posts} p JOIN ${db.users} u ON u.id = p.author
			WHERE p.published AND u.name IS NOT NULL
		`.parse(Schema.object({ title: Schema.string(), name: Schema.string() }));

		expect(feed).toEqual([{ title: "Two", name: "Ross" }]);

		await db.sql`DELETE FROM ${db.users} WHERE ${db.users.columns.id} = ${user!.id}`;

		expect(await db.sql`SELECT count(*)::int AS n FROM ${db.posts}`).toEqual([
			{ n: 0 },
		]);
	});

	test("writes JSON null into a NOT NULL JSON column", async () => {
		const other = new Table("other", { data: Schema.unknown() });
		const db = new Database(pool, [other]);

		await pool.query(
			"DROP TABLE IF EXISTS other; CREATE TABLE other (data jsonb NOT NULL)",
		);
		await db.sql`INSERT INTO ${db.other} ${db.sql.values(db.other, { data: null })}`;

		expect(await db.check()).toEqual([]);
		expect(await db.sql`SELECT * FROM ${db.other}`.parse(db.other)).toEqual([
			{ data: null },
		]);
		expect(
			await db.sql`SELECT jsonb_typeof(data) AS type FROM ${db.other}`,
		).toEqual([{ type: "null" }]);
	});

	test("rejects rows that do not match the schema", async () => {
		await migrate();
		await db.sql`INSERT INTO ${db.users} (email, visits, meta, tags) VALUES ('not an email', 1, '{}', '[]')`;

		await expect(
			db.sql`SELECT * FROM ${db.users}`.parse(db.users),
		).rejects.toThrow(Schema.AggregateIssue);
	});

	test.skipIf(!driver.errors)("constraints are enforced", async () => {
		await migrate();

		await expect(
			db.sql`INSERT INTO ${db.posts} ${db.sql.values(db.posts, {
				id: 1,
				author: crypto.randomUUID(),
				title: "Orphan",
			})}`,
		).rejects.toThrow(/foreign key/);
	});

	test.skipIf(!driver.errors)("transactions commit and roll back", async () => {
		await migrate();

		const insert = (sql: Database.Tag, email: string) =>
			sql`INSERT INTO ${db.users} ${sql.values(db.users, {
				email,
				visits: 0n,
				meta: { theme: "" },
				tags: [],
			})}`;

		await db.sql(async (t) => {
			await insert(t.sql, "a@example.com");
		});
		await expect(
			db.sql(async (t) => {
				await insert(t.sql, "b@example.com");
				await insert(t.sql, "a@example.com");
			}),
		).rejects.toThrow(/unique/);

		expect(await db.sql`SELECT email FROM ${db.users} ORDER BY email`).toEqual([
			{ email: "a@example.com" },
		]);
	});

	test.skipIf(!driver.errors)(
		"a caught database error cannot report a rolled-back transaction as successful",
		async () => {
			await db.sql`CREATE TABLE other (id integer)`;

			await expect(
				db.sql(async (t) => {
					await t.sql`INSERT INTO other VALUES (1)`;
					try {
						await t.sql`SELECT 1 / 0`;
					} catch {
						// Catching the statement error does not restore the transaction.
					}
					return "saved";
				}),
			).rejects.toThrow();
			expect(await db.sql`SELECT * FROM other`).toEqual([]);
		},
	);

	test("a lazy query cannot execute after its transaction releases the connection", async () => {
		await db.sql`CREATE TABLE other (id integer)`;
		const result = await db.sql(async (t) => ({
			query: t.sql`INSERT INTO other VALUES (1)`,
		}));

		await expect(result.query).rejects.toThrow();
		expect(await db.sql`SELECT * FROM other`).toEqual([]);
	});

	test("an escaped transaction tag cannot execute inside a later transaction", async () => {
		await db.sql`CREATE TABLE other (id integer)`;
		const sql = await db.sql(async (t) => t.sql);

		await db.sql(async () => {
			await expect(sql`INSERT INTO other VALUES (1)`).rejects.toThrow();
		});
		expect(await db.sql`SELECT * FROM other`).toEqual([]);
	});

	test.skipIf(!driver.errors)(
		"migrate rolls back a failing migration",
		async () => {
			await expect(
				db.migrate([
					{ id: "0001", sql: "CREATE TABLE other (id int); SELECT nope" },
				]),
			).rejects.toThrow();
			// the history table was created in the same rolled back transaction
			expect(
				await db.sql`SELECT to_regclass('other')::text AS a, to_regclass('migrations')::text AS b`,
			).toEqual([{ a: null, b: null }]);
		},
	);

	test("migration history work scales linearly when bootstrapping a database", async () => {
		let scanned = 0;
		const db = new Database(
			{
				query: pool.query.bind(pool),
				connect: async () => {
					const client = await pool.connect();
					return {
						query: async (text, values) => {
							const result = await client.query(text, values);
							if (/\bFROM\s+migrations\b/i.test(text))
								scanned += result.rows.length;
							return result;
						},
						release: (error) => client.release(error),
					};
				},
			},
			[],
		);
		const migrations = Array.from({ length: 32 }, (_, i) => ({
			id: String(i).padStart(4, "0"),
			sql: "SELECT 1",
		}));

		expect(await db.migrate(migrations)).toHaveLength(migrations.length);
		// Allow several complete reads, but not 1 + 2 + ... + N history rows.
		expect(scanned).toBeLessThanOrEqual(migrations.length * 4);
	});

	test("migrate rejects changed, missing, and out of order migrations", async () => {
		await migrate();

		await expect(
			db.migrate([{ id: "0001_init", sql: `${init};` }]),
		).rejects.toThrow("0001_init has changed");
		await expect(db.migrate([])).rejects.toThrow("0001_init is missing");
		await expect(
			db.migrate([
				{ id: "0000_early", sql: "SELECT 1" },
				{ id: "0001_init", sql: init },
			]),
		).rejects.toThrow("sorts before applied migration 0001_init");
	});

	// needs separate backends, which only real Postgres provides
	test.skipIf(driver.name !== "postgres")(
		"concurrent migrations apply each migration once",
		async () => {
			const migrations = [
				{ id: "0001_init", sql: init },
				{ id: "0002_slow", sql: "SELECT pg_sleep(0.2)" },
			];
			const results = await Promise.all([
				db.migrate(migrations),
				new Database(pool, [users, posts]).migrate(migrations),
			]);

			expect(results.flat().sort()).toEqual(["0001_init", "0002_slow"]);
		},
	);

	test("migrate applies SQL the tables do not describe, check verifies columns", async () => {
		const other = new Table(
			"other",
			{
				id: Schema.number().int(),
				slug: Schema.string(),
				role: Schema.enum(["a", "b"]),
				total: Schema.number(),
			},
			{ default: ["id", "total"] },
		);
		const db = new Database(pool, [other]);

		await pool.query(
			"DROP TYPE IF EXISTS other_role; DROP DOMAIN IF EXISTS other_slug",
		);
		expect(
			await db.migrate([
				{
					id: "0001",
					sql: `
						CREATE DOMAIN other_slug AS text CHECK (VALUE <> '');
						CREATE TYPE other_role AS ENUM ('a', 'b');
						CREATE TABLE other (
							id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
							slug other_slug NOT NULL,
							role other_role NOT NULL,
							total numeric NOT NULL GENERATED ALWAYS AS (id * 2) STORED
						);
						CREATE UNIQUE INDEX ON other (slug) WHERE role = 'a';
					`,
				},
			]),
		).toEqual(["0001"]);
		expect(await db.check()).toEqual([]);

		const [row] = await db.sql`
			INSERT INTO ${db.other} ${db.sql.values(db.other, { slug: "x", role: "a" })}
			RETURNING *
		`.parse(db.other);

		expect(row).toEqual({ id: 1, slug: "x", role: "a", total: 2 });
	});

	test("check reads NOT NULL and defaults from domains", async () => {
		const other = new Table(
			"other",
			{
				id: Schema.string(),
				code: Schema.string().nullable(),
				slug: Schema.string(),
			},
			{ default: ["id"] },
		);

		await pool.query(`
			DROP TABLE IF EXISTS other;
			DROP DOMAIN IF EXISTS other_id, other_code, other_slug, other_base;
			CREATE DOMAIN other_base AS text DEFAULT 'x';
			CREATE DOMAIN other_id AS other_base;
			CREATE DOMAIN other_code AS text NOT NULL;
			CREATE DOMAIN other_slug AS text NOT NULL;
			CREATE TABLE other (id other_id NOT NULL, code other_code, slug other_slug, extra other_code);
		`);

		expect((await new Database(pool, [other]).check()).sort()).toEqual([
			"other.code: expected NULL, found NOT NULL",
			"other.extra: unexpected NOT NULL column without a default",
		]);
	});

	test("decodes driver values by column type", async () => {
		const row = await db.sql`
			SELECT 9007199254740993::int8 AS big, 3::int8 AS count, 1.5::numeric AS ratio,
				ARRAY[1, 2]::int8[] AS ids, ARRAY[[1, NULL], [3, 4]]::numeric[] AS grid,
				json_build_object('at', now()) AS event,
				'["1"]'::jsonb AS strings
		`.parse(
			Schema.object({
				big: Schema.bigint(),
				count: Schema.number(),
				ratio: Schema.number(),
				ids: Schema.array(Schema.number()),
				grid: Schema.array(Schema.array(Schema.bigint().nullable())),
				event: Schema.object({ at: Schema.date() }),
				strings: Schema.array(Schema.string()),
			}),
		);

		expect(row).toEqual([
			{
				big: 9007199254740993n,
				count: 3,
				ratio: 1.5,
				ids: [1, 2],
				grid: [
					[1n, null],
					[3n, 4n],
				],
				event: { at: expect.any(Date) },
				strings: ["1"],
			},
		]);
		// JSON strings are not numbers, and integers are never rounded
		await expect(
			db.sql`SELECT '["1"]'::jsonb AS strings`.parse(
				Schema.object({ strings: Schema.array(Schema.number()) }),
			),
		).rejects.toThrow(Schema.AggregateIssue);
		await expect(
			db.sql`SELECT 9007199254740993::int8 AS big`.parse(
				Schema.object({ big: Schema.number() }),
			),
		).rejects.toThrow(Schema.AggregateIssue);
		// pg parses numeric[] items as numbers, already rounded
		await expect(
			db.sql`SELECT ARRAY[9007199254740993]::numeric[] AS big`.parse(
				Schema.object({ big: Schema.array(Schema.number()) }),
			),
		).rejects.toThrow(Schema.AggregateIssue);
	});

	test("driver decoding does not coerce invalid values inside JSON columns", async () => {
		await expect(
			db.sql`SELECT '{"count":"1"}'::jsonb AS metadata`.parse(
				Schema.object({ metadata: Schema.object({ count: Schema.number() }) }),
			),
		).rejects.toThrow(Schema.AggregateIssue);
	});

	test("numeric field projections reject rounded driver array values", async () => {
		await expect(
			db.sql`SELECT ARRAY[9007199254740993]::numeric[] AS values`.parse(
				Schema.object({ values: Schema.array(Field.number()) }),
			),
		).rejects.toThrow(Schema.AggregateIssue);
	});

	test("numeric form columns reject database integers that would lose precision", async () => {
		const table = new Table("other", { value: Field.number() });

		expect(await db.sql`SELECT 42::bigint AS value`.parse(table)).toEqual([
			{ value: 42 },
		]);
		await expect(
			db.sql`SELECT 9007199254740993::bigint AS value`.parse(table),
		).rejects.toThrow(Schema.AggregateIssue);
	});

	test.skipIf(!driver.errors)(
		"recognizes unique violations by constraint",
		async () => {
			await pool.query(
				"DROP TABLE IF EXISTS other; CREATE TABLE other (a int CONSTRAINT other_a UNIQUE, b int)",
			);
			await db.sql`INSERT INTO other (a) VALUES (${1})`;
			const error = await db.sql`INSERT INTO other (a) VALUES (${1})`.catch(
				(error: unknown) => error,
			);

			expect(Database.unique(error)).toBe(true);
			expect(Database.unique(error, "other_a")).toBe(true);
			expect(Database.unique(error, "users_email_key")).toBe(false);

			const other =
				await db.sql`INSERT INTO other (a, b) VALUES (${2}, ${"x"})`.catch(
					(error: unknown) => error,
				);
			expect(Database.unique(other)).toBe(false);
			expect(Database.unique(new Error("x"))).toBe(false);
			expect(Database.unique({ code: "23505" })).toBe(false);
		},
	);

	test("check reports differences", async () => {
		await pool.query(`
			CREATE TABLE users (
				id uuid PRIMARY KEY,
				email varchar(320),
				name integer,
				visits bigint NOT NULL DEFAULT 0,
				meta json NOT NULL,
				extra text NOT NULL,
				notes text
			);
			CREATE UNIQUE INDEX ON users (name);
			CREATE TABLE posts (
				id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				author uuid NOT NULL REFERENCES users(id),
				title character varying NOT NULL,
				published boolean NOT NULL DEFAULT false
			);
			CREATE UNIQUE INDEX ON posts (title) WHERE published;
		`);

		expect((await db.check()).sort()).toEqual(
			[
				"users.created: missing column (timestamp with time zone NOT NULL)",
				"users.email: expected NOT NULL, found NULL",
				"users.extra: unexpected NOT NULL column without a default",
				"users.id: missing default",
				"users.name: integer cannot store string values, use text, character varying, character, citext, uuid, enum",
				"users.tags: missing column (jsonb NOT NULL)",
			].sort(),
		);
	});

	test("check reports missing tables", async () => {
		expect(await db.check()).toEqual([
			"users: missing table",
			"posts: missing table",
		]);
	});
});
