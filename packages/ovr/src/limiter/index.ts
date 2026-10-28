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
	/** Required shared storage, with a default policy of 60 requests per minute. */
	export interface Options extends Partial<Policy> {
		/** Stable namespace, shared by all instances using the same external store. */
		readonly name?: string;
		/** Override trusted-IP keying, for example with an authenticated user ID. Missing keys fail closed. */
		readonly key?: (
			c: Context,
		) => string | undefined | Promise<string | undefined>;
		/**
		 * Shared storage. Atomically refill and consume a token for this key.
		 * Return true when admitted, or an absolute retry time in milliseconds when denied.
		 * Every instance must use the same policy and stable namespace. Failures must throw.
		 */
		readonly consume: (
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
	/** Create a policy backed by the application's shared atomic storage operation. */
	constructor(options: Limiter.Options) {
		if (typeof options?.consume !== "function")
			throw new TypeError(
				"Limiter requires shared rate-limit storage in consume",
			);
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
		const key = JSON.stringify([this.#options.name, scope, identity]);
		const { limit, interval } = this.#options;
		const retry = await this.#options.consume(key, { limit, interval });
		if (retry === true) return true;
		if (!Number.isSafeInteger(retry) || retry <= 0)
			throw new LimitIssue("Invalid shared limiter result");
		const now = Date.now();
		return new Date(Math.min(now + 3600000, Math.max(now + 1000, retry)));
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
