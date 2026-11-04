import { Database, owned, references } from "../database/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Storage } from "./storage.js";
import pg from "pg";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

// Independent Postgres backends are required; PGlite serializes these writes.
describe.skipIf(!process.env.OVR_TEST_DATABASE_URL)(
	"concurrent auth storage",
	() => {
		const schema = `ovr_storage_${crypto.randomUUID().replaceAll("-", "")}`;
		let pool: pg.Pool;
		let db: Database;
		let storage: Storage;

		/** The test's users table, registered for the database as new Auth() does */
		const accounts = new Table("deletion_users", { id: Schema.string() });
		const register = () =>
			references.set(
				db,
				new Map(
					[Storage.credentials, Storage.sessions, Storage.tokens].map(
						(table) => [table, accounts],
					),
				),
			);

		beforeAll(async () => {
			pool = new pg.Pool({
				connectionString: process.env.OVR_TEST_DATABASE_URL,
				options: `-c search_path=${schema}`,
				application_name: schema,
				max: 12,
			});
			await pool.query(`CREATE SCHEMA ${schema}`);
			await pool.query(owned.get(Storage.tokens)![1]!.sql);
			await pool.query(`
			CREATE TABLE auth_sessions (id text PRIMARY KEY, expiration bigint NOT NULL);
			CREATE TABLE auth_challenges (
				id text PRIMARY KEY, challenge text NOT NULL, browser text NOT NULL,
				method text NOT NULL, action text NOT NULL, origin text NOT NULL,
				expiration bigint NOT NULL, "user" text, fields text
			);
			CREATE FUNCTION overlap() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				IF NEW.id LIKE 'race-%' THEN PERFORM pg_sleep(0.05); END IF;
				RETURN NEW;
			END $$;
			CREATE TRIGGER overlap BEFORE INSERT ON auth_challenges
				FOR EACH ROW EXECUTE FUNCTION overlap();
		`);
			// Establish all connections before racing, so connection startup does not serialize requests.
			const clients = await Promise.all(
				Array.from({ length: 12 }, () => pool.connect()),
			);
			for (const client of clients) client.release();
			db = new Database(pool, []);
			storage = new Storage(db);
		});

		afterAll(async () => {
			try {
				await pool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			} finally {
				await pool?.end();
			}
		});

		beforeEach(() => pool.query("TRUNCATE auth_challenges, auth_sessions"));

		test("replay revokes tokens being issued concurrently in the same family", async () => {
			const row: Storage.Token = {
				kind: "refresh",
				user: "user-1",
				client: "agent",
				scope: "",
				resource: "https://example.com/mcp",
				expiration: Date.now() + 60_000,
			};
			await storage.tokens.set("first", row);
			await storage.tokens.exchange("first", "refresh", async () => ({
				second: row,
			}));
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const rotation = storage.tokens.exchange(
				"second",
				"refresh",
				async () => {
					entered.resolve();
					await release.promise;
					return { survivor: { ...row, kind: "access" } };
				},
			);
			await entered.promise;
			let done = false;
			const replay = storage.tokens
				.exchange("first", "refresh", async () => undefined)
				.finally(() => {
					done = true;
				});
			try {
				// Wait until revocation has started, even if it must wait for the rotation.
				await vi.waitFor(
					async () => {
						const waiting = await pool.query(
							"SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
							[schema],
						);
						expect(done || waiting.rows.length > 0).toBe(true);
					},
					{ timeout: 3000 },
				);
			} finally {
				release.resolve();
				await Promise.all([rotation, replay]);
			}
			expect(await storage.tokens.get("survivor")).toBeUndefined();
		});

		test("documented agent disconnection revokes tokens issued by an in-flight refresh", async () => {
			const row: Storage.Token = {
				kind: "refresh",
				user: "disconnect-user",
				client: "disconnect-agent",
				scope: "",
				resource: "https://example.com/mcp",
				expiration: Date.now() + 60_000,
			};
			await storage.tokens.set("disconnect-first", row);
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const rotation = storage.tokens.exchange(
				"disconnect-first",
				"refresh",
				async () => {
					entered.resolve();
					await release.promise;
					return {
						"disconnect-access": { ...row, kind: "access" },
						"disconnect-refresh": row,
					};
				},
			);
			await entered.promise;
			// the operation behind auth.disconnect, which waits for the exchange
			const disconnect = storage.tokens.revoke(row.user, row.client);
			try {
				await vi.waitFor(
					async () => {
						const waiting = await pool.query(
							"SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
							[schema],
						);
						expect(waiting.rows.length).toBeGreaterThan(0);
					},
					{ timeout: 3000 },
				);
			} finally {
				release.resolve();
				await Promise.all([rotation, disconnect]);
			}
			expect
				.soft(await storage.tokens.get("disconnect-access"))
				.toBeUndefined();
			expect
				.soft(
					await storage.tokens.exchange(
						"disconnect-refresh",
						"refresh",
						async () => ({
							"disconnect-successor": { ...row, kind: "access" },
						}),
					),
				)
				.toBe(false);
		});

		test("account deletion completes while a refresh is issuing tokens", async () => {
			await pool.query("TRUNCATE auth_tokens");
			await pool.query("CREATE TABLE deletion_users (id text PRIMARY KEY)");
			register();
			await pool.query(`ALTER TABLE auth_tokens ADD CONSTRAINT deletion_tokens
				FOREIGN KEY ("user") REFERENCES deletion_users ON DELETE CASCADE`);
			try {
				const row: Storage.Token = {
					kind: "refresh",
					user: "deletion-user",
					client: "deletion-agent",
					scope: "",
					resource: "https://example.com/mcp",
					expiration: Date.now() + 60_000,
				};
				await pool.query("INSERT INTO deletion_users (id) VALUES ($1)", [
					row.user,
				]);
				await storage.tokens.set("deletion-first", row);
				const entered = Promise.withResolvers<void>();
				const release = Promise.withResolvers<void>();
				const rotation = storage.tokens.exchange(
					"deletion-first",
					"refresh",
					async () => {
						entered.resolve();
						await release.promise;
						return { "deletion-access": { ...row, kind: "access" } };
					},
				);
				await entered.promise;
				// the refresh holds the account, so the deletion waits for it
				const deletion = pool.query(
					"DELETE FROM deletion_users WHERE id = $1",
					[row.user],
				);
				const completed = Promise.allSettled([rotation, deletion]);
				try {
					await vi.waitFor(
						async () => {
							const waiting = await pool.query(
								"SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
								[schema],
							);
							expect(waiting.rows.length).toBeGreaterThan(0);
						},
						{ timeout: 3000 },
					);
				} finally {
					release.resolve();
				}
				// both complete, then the account's deletion removes what the refresh issued
				const [issued, deleted] = await completed;
				expect(issued).toMatchObject({ status: "fulfilled", value: true });
				expect(deleted.status).toBe("fulfilled");
				expect(
					(await pool.query("SELECT id FROM deletion_users")).rows,
				).toEqual([]);
				expect(await storage.tokens.get("deletion-access")).toBeUndefined();
			} finally {
				await pool.query(
					"ALTER TABLE auth_tokens DROP CONSTRAINT deletion_tokens",
				);
				await pool.query("DROP TABLE deletion_users");
				references.delete(db);
			}
		});

		test.each(["NOT DEFERRABLE", "DEFERRABLE INITIALLY DEFERRED"])(
			"account deletion and refresh complete with a %s foreign key",
			async (timing) => {
				await pool.query("TRUNCATE auth_tokens");
				await pool.query("CREATE TABLE deletion_users (id text PRIMARY KEY)");
				register();
				await pool.query(`ALTER TABLE auth_tokens ADD CONSTRAINT deletion_tokens
				FOREIGN KEY ("user") REFERENCES deletion_users ON DELETE CASCADE ${timing}`);
				// Pause after spending the original token. An immediate foreign key has
				// already locked the account; a deferred key checks it only at commit.
				await pool.query(`
				CREATE FUNCTION pause() RETURNS trigger LANGUAGE plpgsql AS $$
				BEGIN
					IF NEW.client = 'holding-agent' AND NEW.kind = 'spent' THEN PERFORM pg_sleep(0.5); END IF;
					RETURN NULL;
				END $$;
				CREATE CONSTRAINT TRIGGER zz_pause AFTER UPDATE ON auth_tokens
					FOR EACH ROW EXECUTE FUNCTION pause();
			`);
				try {
					const row: Storage.Token = {
						kind: "refresh",
						user: "holding-user",
						client: "holding-agent",
						scope: "",
						resource: "https://example.com/mcp",
						expiration: Date.now() + 60_000,
					};
					await pool.query("INSERT INTO deletion_users (id) VALUES ($1)", [
						row.user,
					]);
					await storage.tokens.set("holding-first", row);
					const rotation = storage.tokens.exchange(
						"holding-first",
						"refresh",
						async () => ({ "holding-access": { ...row, kind: "access" } }),
					);
					const deletion = (async () => {
						// Once the refresh has locked the token row, start deleting its user.
						await vi.waitFor(
							async () => {
								const sleeping = await pool.query(
									"SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND query LIKE '%UPDATE%auth_tokens%' AND wait_event = 'PgSleep'",
									[schema],
								);
								expect(sleeping.rows.length).toBeGreaterThan(0);
							},
							{ timeout: 3000, interval: 10 },
						);
						await pool.query("DELETE FROM deletion_users WHERE id = $1", [
							row.user,
						]);
					})();

					// both complete, neither is aborted as a deadlock
					const results = await Promise.allSettled([rotation, deletion]);
					for (const result of results)
						expect
							.soft(result.status === "rejected" ? result.reason : undefined)
							.toBeUndefined();
					expect
						.soft(results[0])
						.toMatchObject({ status: "fulfilled", value: true });
					expect
						.soft((await pool.query("SELECT id FROM deletion_users")).rows)
						.toEqual([]);
					// the deletion waited, then removed the tokens the refresh issued
					expect
						.soft(await storage.tokens.get("holding-access"))
						.toBeUndefined();
				} finally {
					await pool.query("DROP TRIGGER zz_pause ON auth_tokens");
					await pool.query("DROP FUNCTION pause()");
					await pool.query(
						"ALTER TABLE auth_tokens DROP CONSTRAINT deletion_tokens",
					);
					await pool.query("DROP TABLE deletion_users");
					references.delete(db);
				}
			},
		);

		test.each(["browser", "total"])(
			"enforces the %s capacity across concurrent requests",
			async (scope) => {
				const capacity = scope === "browser" ? 10 : 10000;
				const challenge: Storage.Challenge = {
					challenge: "challenge",
					browser: "browser",
					method: "login",
					action: "/auth/login",
					origin: "https://example.com",
					expiration: Date.now() + 120000,
				};
				// Complete pruning before the race and leave exactly one slot available.
				await storage.challenges.set("warmup", challenge);
				await storage.challenges.take("warmup");
				await db.sql`
			INSERT INTO auth_challenges (id, challenge, browser, method, action, origin, expiration)
			SELECT 'seed-' || i, 'challenge',
				CASE WHEN ${scope} = 'browser' THEN 'browser' ELSE 'browser-' || i END,
				'login', '/auth/login', 'https://example.com', ${challenge.expiration}
			FROM generate_series(1, ${capacity - 1}::int) AS i
		`;

				const results = await Promise.all(
					Array.from({ length: 12 }, (_, i) =>
						storage.challenges.set(`race-${i}`, {
							...challenge,
							browser: scope === "browser" ? "browser" : `race-${i}`,
						}),
					),
				);

				expect(results.filter(Boolean)).toHaveLength(1);
				expect(
					(
						await pool.query(
							"SELECT count(*)::int AS count FROM auth_challenges",
						)
					).rows,
				).toEqual([{ count: capacity }]);
			},
		);
	},
);
