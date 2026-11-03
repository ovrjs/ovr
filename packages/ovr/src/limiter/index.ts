import type { Context as ContextType } from "../context/index.js";
import type { Database } from "../database/index.js";
import type { Middleware } from "../middleware/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Time } from "../util/index.js";

export namespace Limiter {
	/** Request capabilities available before parsing a body. */
	export type Context = Pick<
		ContextType,
		"req" | "url" | "ip" | "cookie" | "res"
	>;
	/** A token bucket allows an initial burst, then replenishes continuously. */
	export interface Policy {
		readonly limit: number;
		readonly interval: number;
	}
	/** Shared Postgres storage, with a default policy of 60 requests per minute. */
	export interface Options extends Partial<Policy> {
		/** Database containing `Limiter.table`, shared by every instance. */
		readonly database: Database;
		/** Stable namespace, shared by all instances using the same database. */
		readonly name?: string;
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
	 * Migration SQL creating `Limiter.table`, by version. A version never
	 * changes, so its checksum stays valid; later changes ship as new versions.
	 * `Auth.sql` already includes it.
	 *
	 * ```ts
	 * await db.migrate([{ id: "0002_limits", sql: Limiter.sql[1] }, ...]);
	 * ```
	 */
	static readonly sql = {
		1: `CREATE TABLE rate_limits (
	key text PRIMARY KEY,
	tokens double precision NOT NULL,
	time bigint NOT NULL,
	expiration bigint NOT NULL
);
CREATE INDEX rate_limits_expiration ON rate_limits (expiration);
`,
	} as const;

	/** Token buckets shared by every limiter, include it in the database's tables. */
	static readonly table = new Table("rate_limits", {
		key: Schema.string(),
		tokens: Schema.number(),
		time: Schema.number().int(),
		expiration: Schema.number().int(),
	});

	readonly #options;
	#pruned = 0;

	/** Create a policy backed by the application's database. */
	constructor(options: Limiter.Options) {
		if (typeof options?.database?.sql !== "function")
			throw new TypeError("Limiter requires a database");
		this.#options = {
			limit: 60,
			interval: 60000,
			name: "requests",
			...options,
		};
		for (const [name, value] of Object.entries({
			limit: this.#options.limit,
			interval: this.#options.interval,
		})) {
			if (
				!Number.isSafeInteger(value) ||
				value < 1 ||
				(name === "interval" && (value < 1000 || value > 31536000000))
			)
				throw new TypeError(`Invalid limiter ${name}`);
		}
		if (!this.#options.name || this.#options.name.length > 512)
			throw new TypeError("Invalid limiter namespace");
	}

	/** Admit a request or return its retry deadline. Scopes have independent budgets. */
	async check(c: Limiter.Context, scope = ""): Promise<true | Date> {
		const identity = this.#options.key
			? await this.#options.key(c)
			: Limiter.#ip(c.ip);
		if (typeof identity !== "string" || !identity || identity.length > 1024)
			throw new LimitIssue(
				"Rate limiting requires a trusted client IP in App.fetch(request, { ip }), or an explicit authenticated key",
			);
		const { limit, interval } = this.#options;
		// Different policies cannot interpret the same stored token balance differently.
		const retry = await this.#consume(
			JSON.stringify([this.#options.name, limit, interval, scope, identity]),
		);
		if (retry === true) return true;
		const now = Date.now();
		return new Date(
			Math.min(now + 3600000, Math.max(now + 1000, Math.ceil(retry))),
		);
	}

	/** Mount globally with app.use(), or on selected routes. Missing identity/storage failures return 503. */
	readonly middleware: Middleware = async (c, next) => {
		let result: true | Date;
		try {
			result = await this.check(c);
		} catch (error) {
			console.error(error);
			c.res.headers.set("cache-control", "no-store");
			c.text("Service temporarily unavailable. Try again later.", 503);
			return;
		}
		if (result === true) return next();
		c.res.headers.set("cache-control", "no-store");
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

	/**
	 * @param value Client IP
	 * @returns The IPv4 address, or the IPv6 /64 network, one home or office
	 */
	static #ip(value: string | undefined) {
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
}
