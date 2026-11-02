import { Database } from "../database/index.js";
import { Storage } from "./storage.js";
import pg from "pg";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

// Independent Postgres backends are required; PGlite serializes these writes.
describe.skipIf(!process.env.OVR_TEST_DATABASE_URL)(
	"concurrent challenge storage",
	() => {
		const schema = `ovr_storage_${crypto.randomUUID().replaceAll("-", "")}`;
		let pool: pg.Pool;
		let db: Database;
		let storage: Storage;

		beforeAll(async () => {
			pool = new pg.Pool({
				connectionString: process.env.OVR_TEST_DATABASE_URL,
				options: `-c search_path=${schema}`,
				max: 12,
			});
			await pool.query(`CREATE SCHEMA ${schema}`);
			await pool.query(`
			CREATE TABLE ovr_sessions (id text PRIMARY KEY, expiration bigint NOT NULL);
			CREATE TABLE ovr_challenges (
				id text PRIMARY KEY, challenge text NOT NULL, browser text NOT NULL,
				method text NOT NULL, action text NOT NULL, origin text NOT NULL,
				expiration bigint NOT NULL, "user" text, fields text
			);
			CREATE FUNCTION overlap() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				IF NEW.id LIKE 'race-%' THEN PERFORM pg_sleep(0.05); END IF;
				RETURN NEW;
			END $$;
			CREATE TRIGGER overlap BEFORE INSERT ON ovr_challenges
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

		beforeEach(() => pool.query("TRUNCATE ovr_challenges, ovr_sessions"));

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
			INSERT INTO ovr_challenges (id, challenge, browser, method, action, origin, expiration)
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
							"SELECT count(*)::int AS count FROM ovr_challenges",
						)
					).rows,
				).toEqual([{ count: capacity }]);
			},
		);
	},
);
