import { Context } from "../context/index.js";
import type { Middleware } from "../middleware/index.js";
import type { Multipart } from "../multipart/index.js";
import { Route } from "../route/index.js";
import { Trie } from "../trie/index.js";
import type { DeepArray } from "../types/index.js";

export namespace App {
	export namespace Options {
		/** Trailing slash preference */
		export type TrailingSlash = "always" | "never" | "ignore";
	}

	/** Configuration options */
	export type Options = {
		/**
		 * Basic
		 * [cross-site request forgery (CSRF)](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF)
		 * protection that checks the request's `method`, and its
		 * [`Sec-Fetch-Site`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site)
		 * and [`Origin`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin)
		 * headers.
		 *
		 * More robust protection requires a stateful server or a database to store
		 * [CSRF tokens](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF#csrf_tokens).
		 *
		 * @default true
		 */
		readonly csrf?: boolean;

		/**
		 * - `"never"` - Not found requests with a trailing slash will be redirected to the same path without a trailing slash
		 * - `"always"` - Not found requests without a trailing slash will be redirected to the same path with a trailing slash
		 * - `"ignore"` - no redirects (not recommended, bad for SEO)
		 *
		 * [Trailing Slash for Frameworks by Bjorn Lu](https://bjornlu.com/blog/trailing-slash-for-frameworks)
		 *
		 * @default "never"
		 */
		readonly trailingSlash?: Options.TrailingSlash;

		/**
		 * Multipart parser options
		 * (overridden by options passed into `Context.data(options)`)
		 */
		readonly multipart?: Multipart.Options;
	};
}

/** Web server application */
export class App {
	/** Route trie */
	readonly #trie = new Trie();

	/** Global middleware */
	readonly #global: Middleware[] = [];

	/** App options */
	readonly #options;

	/**
	 * Create a new application.
	 *
	 * @param options configuration options
	 */
	constructor(options?: App.Options) {
		this.#options = Object.assign(
			{ csrf: true, trailingSlash: "never" },
			options,
		);

		if (this.#options.csrf === true) this.#global.push(App.#csrf);

		if (this.#options.trailingSlash !== "ignore") {
			this.#global.push(App.#createTrailingSlash(this.#options.trailingSlash));
		}
	}

	/**
	 * @param routes Route or middleware to use
	 * @returns `App` instance
	 */
	use(
		...routes: DeepArray<
			Route | Middleware | Record<string, Route | Middleware>
		>[]
	) {
		for (const route of routes) {
			if (route instanceof Route) {
				this.#trie.add(route);
			} else if (route instanceof Array) {
				this.use(...route);
			} else if (typeof route === "function") {
				this.#global.push(route);
			} else {
				this.use(...Object.values(route));
			}
		}

		return this;
	}

	/**
	 * Request a resource from the application.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch)
	 *
	 * @param resource [Resource](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch#resource) to fetch
	 * @param options [Options](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch#options) to apply to the request
	 * @returns Promise that resolves to the [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) to the request
	 */
	readonly fetch = async (
		resource: RequestInfo | URL,
		options?: RequestInit,
	) => {
		const c = new Context(new Request(resource, options), this.#options);

		return Object.assign(
			c,
			// match
			this.#trie.find(
				// use GET for HEAD requests to find the correct route
				(c.req.method === "HEAD" ? "GET" : c.req.method) + c.url.pathname,
			),
		).build(this.#global.concat(c.route?.middleware ?? []));
	};

	/** Basic CSRF middleware */
	static #csrf(c: Middleware.Context, next: Middleware.Next) {
		if (
			c.req.method === "GET" ||
			c.req.method === "HEAD" ||
			c.req.headers.get("sec-fetch-site") === "same-origin" ||
			c.req.headers.get("origin") === c.url.origin
		) {
			return next();
		}

		c.text("Forbidden", 403);
	}

	/** @returns Trailing slash middleware */
	static #createTrailingSlash(mode: App.Options.TrailingSlash) {
		return async (c: Context, next: Middleware.Next) => {
			await next();

			if (c.res.status && c.res.status !== 404) return;

			const last = c.url.pathname.at(-1);

			if (mode === "always" && last !== "/") {
				c.url.pathname += "/";
				c.redirect(c.url, 308);
			} else if (mode === "never" && c.url.pathname !== "/" && last === "/") {
				c.url.pathname = c.url.pathname.slice(0, -1);
				c.redirect(c.url, 308);
			}
		};
	}
}
