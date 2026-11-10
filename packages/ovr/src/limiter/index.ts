import type { Context as ContextType } from "../context/index.js";
import { type Database, owned } from "../database/index.js";
import type { Middleware } from "../middleware/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Codec, Time, noStore } from "../util/index.js";

/**
 * Internal to ovr, which counts each client this way.
 *
 * @param value Client IP
 * @returns The IPv4 address, or the IPv6 /64 network, one home or office
 */
export function network(value: string | undefined) {
	if (!value || value.length > 64 || !/^[\da-f:.]+$/i.test(value)) return;
	if (!value.includes(":"))
		return value.split(".").length === 4 &&
			value
				.split(".")
				.every((v) => /^(0|[1-9]\d{0,2})$/.test(v) && Number(v) <= 255)
			? value
			: undefined;
	let host: string;
	try {
		host = new URL(`http://[${value}]`).hostname;
	} catch {
		return;
	}
	const [head = "", tail = ""] = host.slice(1, -1).split("::");
	const first = head ? head.split(":") : [];
	const last = tail ? tail.split(":") : [];
	const groups: string[] = [
		...first,
		...Array<string>(8 - first.length - last.length).fill("0"),
		...last,
	];
	// IPv4-mapped IPv6 addresses share their IPv4 budget, rather than one giant ::ffff /64 bucket.
	if (groups.slice(0, 5).every((v) => v === "0") && groups[5] === "ffff") {
		const high = parseInt(groups[6]!, 16);
		const low = parseInt(groups[7]!, 16);
		return [high >> 8, high & 255, low >> 8, low & 255].join(".");
	}
	return (
		groups
			.map((v, i) => (i < 4 ? parseInt(v, 16).toString(16) : "0"))
			.join(":") + "/64"
	);
}

export namespace Limiter {
	/**
	 * Request capabilities available before parsing a body, including the
	 * session, so a `key` can count each signed-in user.
	 */
	export type Context = Pick<
		ContextType,
		"req" | "url" | "ip" | "cookie" | "res" | "session"
	>;
	/** A token bucket allows an initial burst, then replenishes continuously. */
	export interface Policy {
		readonly limit: number;
		readonly interval: number;
	}
	/** Shared Postgres storage, with a default policy of 60 requests per minute. */
	export interface Options extends Partial<Policy> {
		/** Database containing `Limiter.table`, shared by every instance. */
		readonly database: Database & {
			readonly [Name in (typeof Limiter.table)["name"]]: typeof Limiter.table;
		};
		/** Override trusted-IP keying, for example with an authenticated user ID. Missing keys fail closed. */
		readonly key?: (
			c: Context,
		) => string | undefined | Promise<string | undefined>;
	}
}

/** Internal failure to apply a rate limit; callers must not admit the request. */
export class LimitIssue extends Error {}

/** Token buckets stored in Postgres, usable by authentication and ordinary route middleware. */
export class Limiter {
	/**
	 * Token buckets shared by every limiter, include it in the database's
	 * tables. `database.migrate` then creates it, `Auth.tables` already includes it.
	 */
	static readonly table = new Table("rate_limits", {
		key: Schema.string(),
		tokens: Schema.number(),
		time: Schema.number().int(),
		expiration: Schema.number().int(),
	});

	static {
		// a version never changes, later changes ship as new versions
		owned.set(Limiter.table, [
			{
				id: "rate_limits:1",
				sql: `CREATE TABLE rate_limits (
	key text PRIMARY KEY,
	tokens double precision NOT NULL,
	time bigint NOT NULL,
	expiration bigint NOT NULL
);
CREATE INDEX rate_limits_expiration ON rate_limits (expiration);`,
			},
		]);
	}

	readonly #name;
	readonly #options;
	#pruned = 0;

	/**
	 * Create a policy backed by the application's database.
	 *
	 * @param name Stable name of the policy's buckets. Limiters with the same name and policy share them, across every server using the database.
	 */
	constructor(name: string, options: Limiter.Options) {
		this.#options = { limit: 60, interval: Time.minute, ...options };
		this.#name = name;
	}

	/** Admit a request or return its retry deadline. Scopes have independent budgets. */
	async check(c: Limiter.Context, scope = ""): Promise<true | Date> {
		const identity = this.#options.key
			? await this.#options.key(c)
			: network(c.ip);
		if (typeof identity !== "string" || !identity || identity.length > 1024)
			throw new LimitIssue(
				"Rate limiting requires a trusted client IP in App.fetch(request, { ip }), or an explicit authenticated key",
			);
		const { limit, interval } = this.#options;
		// Different policies cannot interpret the same stored token balance
		// differently. Hashed, so a long name, scope, or identity always fits
		// in the primary key's index.
		const retry = await this.#consume(
			Codec.Base64Url.encode(
				new Uint8Array(
					await crypto.subtle.digest(
						"SHA-256",
						Codec.encode(
							JSON.stringify([this.#name, limit, interval, scope, identity]),
						),
					),
				),
			),
		);
		if (retry === true) return true;
		const now = Date.now();
		return new Date(
			Math.min(now + 3600000, Math.max(now + 1000, Math.ceil(retry))),
		);
	}

	/**
	 * Mount globally with app.use(), or on selected routes. A missing identity
	 * or storage failure throws, so the app's error handling sees it and the
	 * request is not admitted.
	 */
	readonly middleware: Middleware = async (c, next) => {
		const result = await this.check(c);
		if (result === true) return next();
		noStore(c.res.headers);
		c.res.headers.set(
			"retry-after",
			String(Math.max(1, Math.ceil((result.getTime() - Date.now()) / 1000))),
		);
		c.text("Too many requests. Try again later.", 429);
	};

	/**
	 * Atomically refill and consume a token, in one statement when admitted.
	 *
	 * @param key Bucket key
	 * @returns `true` when admitted, otherwise the retry time in milliseconds
	 */
	async #consume(key: string) {
		const { database: db, limit, interval } = this.#options;
		const table = Limiter.table;
		const now = Date.now();

		// either direction, so a clock moving back cannot stop pruning
		if (Math.abs(now - this.#pruned) >= Time.minute) {
			this.#pruned = now;
			await db.sql`DELETE FROM ${table} WHERE expiration <= ${now}`;
		}

		// expired buckets start full, others refill continuously since their last use
		const tokens = db.sql`CASE WHEN l.expiration > ${now}::bigint
			THEN LEAST(${limit}::float8, l.tokens + GREATEST(0, ${now}::bigint - l.time) * ${limit}::float8 / ${interval}::float8)
			ELSE ${limit}::float8 END`;
		const admitted = await db.sql`
			INSERT INTO ${table} AS l (key, tokens, time, expiration)
			VALUES (${key}, ${limit - 1}, ${now}, ${now + interval})
			ON CONFLICT (key) DO UPDATE SET
				tokens = ${tokens} - 1,
				time = GREATEST(${now}::bigint, l.time),
				expiration = ${now + interval}
			WHERE ${tokens} >= 1
			RETURNING 1
		`;

		if (admitted.length) return true;

		const [bucket] = await db.sql`
			SELECT * FROM ${table} WHERE key = ${key}
		`.parse(Limiter.table);
		const available =
			!bucket || bucket.expiration <= now
				? limit
				: Math.min(
						limit,
						bucket.tokens + (Math.max(0, now - bucket.time) * limit) / interval,
					);

		return (
			now + Math.max(1000, Math.ceil(((1 - available) * interval) / limit))
		);
	}
}
