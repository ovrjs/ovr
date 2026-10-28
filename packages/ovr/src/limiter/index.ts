import type { Context as ContextType } from "../context/index.js";
import type { Middleware } from "../middleware/index.js";

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
	/** Optional customization; the default is a process-local bucket of 60 requests per minute. */
	export interface Options extends Partial<Policy> {
		/** Stable namespace, shared by all instances using the same external store. */
		readonly name?: string;
		/** Maximum active identities in process memory; defaults to 10,000. */
		readonly capacity?: number;
		/** Override trusted-IP keying, for example with an authenticated user ID. Missing keys fail closed. */
		readonly key?: (
			c: Context,
		) => string | undefined | Promise<string | undefined>;
		/**
		 * Optional shared storage. Atomically refill and consume a token for this key.
		 * Return true when admitted, or an absolute retry time in milliseconds when denied.
		 * Every instance must use the same policy and stable namespace. Failures must throw.
		 */
		readonly consume?: (
			key: string,
			policy: Policy,
		) => true | number | Promise<true | number>;
	}
}

/** Internal failure to apply a rate limit; callers must not admit the request. */
export class LimitIssue extends Error {}

/** Dependency-free token buckets, usable by authentication and ordinary route middleware. */
export class Limiter {
	readonly #options;
	readonly #entries = new Map<string, { tokens: number; time: number }>();
	#pruned = 0;

	/** Create an independent policy. Memory is local to this instance unless consume is supplied. */
	constructor(options: Limiter.Options = {}) {
		this.#options = {
			limit: 60,
			interval: 60000,
			capacity: 10000,
			name: "requests",
			...options,
		};
		for (const name of ["limit", "interval", "capacity"] as const) {
			const value = this.#options[name];
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
		const key = JSON.stringify([this.#options.name, scope, identity]);
		const { limit, interval } = this.#options;
		if (this.#options.consume) {
			const retry = await this.#options.consume(key, { limit, interval });
			if (retry === true) return true;
			if (!Number.isSafeInteger(retry) || retry <= 0)
				throw new LimitIssue("Invalid shared limiter result");
			const now = Date.now();
			return new Date(Math.min(now + 3600000, Math.max(now + 1000, retry)));
		}
		const now = Date.now();
		if (now - this.#pruned >= Math.min(interval, 60000)) {
			for (const [key, value] of this.#entries)
				if (now - value.time >= interval) this.#entries.delete(key);
			this.#pruned = now;
		}
		const previous = this.#entries.get(key);
		if (!previous && this.#entries.size >= this.#options.capacity)
			throw new LimitIssue(
				"Rate limiter capacity exhausted; use shared storage or increase capacity",
			);
		const tokens = previous
			? Math.min(
					limit,
					previous.tokens +
						(Math.max(0, now - previous.time) * limit) / interval,
				)
			: limit;
		if (tokens < 1)
			return new Date(
				now +
					Math.min(
						3600000,
						Math.max(1000, Math.ceil(((1 - tokens) * interval) / limit)),
					),
			);
		// No await between reading and consuming a process-local token.
		this.#entries.set(key, {
			tokens: tokens - 1,
			time: previous ? Math.max(now, previous.time) : now,
		});
		return true;
	}

	/** Mount globally with app.use(), or on selected routes. Missing identity/storage failures return 503. */
	readonly middleware: Middleware = async (c, next) => {
		let result: true | Date;
		try {
			result = await this.check(c);
		} catch {
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

	static #ip(value: string | undefined) {
		if (!value || value.length > 64 || !/^[\da-f:.]+$/i.test(value)) return;
		let host: string;
		try {
			host = new URL(
				value.includes(":") ? `http://[${value}]` : `http://${value}`,
			).hostname;
		} catch {
			return;
		}
		if (!host.startsWith("["))
			return /^(?:\d+\.){3}\d+$/.test(host) ? host : undefined;
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
		return groups.slice(0, 4).join(":") + "::/64";
	}
}
