import { Context } from "../context/index.js";
import type { Middleware } from "../middleware/index.js";
import type { Multipart } from "../multipart/index.js";
import { Route } from "../route/index.js";
import { Trie } from "../trie/index.js";
import { Header, Method, type Util } from "../util/index.js";

/** Internal protocol for services that `app.use` mounts, such as `Auth`. */
export const mount = Symbol("mount");

/** Routes that accept cross-origin requests without cookies, such as OAuth endpoints. */
export const crossOrigin = new WeakSet<Route>();

export namespace App {
	/** What a service can use from the app it is mounted on. */
	export interface Mount {
		/** Every route the app has, including ones added later */
		readonly routes: readonly Route[];

		/** The app's request handler */
		readonly fetch: App["fetch"];

		/**
		 * @param method Request method
		 * @param pathname URL pathname
		 * @returns The route a request would run, before running it
		 */
		find(method: string, pathname: string): Route | undefined;
	}

	/** A service that adds its routes and middleware to the app. */
	export interface Service {
		/**
		 * @param app The app the service is mounted on
		 * @returns Routes and global middleware to use
		 */
		[mount](app: Mount): Util.DeepArray<Route | Middleware>;
	}

	/** Fetch options plus server-supplied connection metadata. */
	export interface Fetch extends RequestInit {
		/** Trusted socket peer or verified edge client IP. Never copy an arbitrary forwarded header. */
		readonly ip?: string | undefined;
	}
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
		 * headers. Requests with neither header nor a `Cookie` are not from a
		 * browser and are allowed.
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
		 * Multipart form data options
		 * (overridden by options passed into `Context.form(options)`)
		 */
		readonly form?: Multipart.Options;
	};
}

/** Web server application */
export class App {
	/** Route trie */
	readonly #trie = new Trie();

	/** Every route added, in order */
	readonly #routes: Route[] = [];

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
		this.#options = { csrf: true, trailingSlash: "never" as const, ...options };

		if (this.#options.csrf) this.#global.push(App.#csrf);

		if (this.#options.trailingSlash !== "ignore") {
			this.#global.push(App.#createTrailingSlash(this.#options.trailingSlash));
		}
	}

	/**
	 * @param routes Routes, middleware, or services such as `Auth` to use
	 * @returns `App` instance
	 */
	use(
		...routes: Util.DeepArray<
			Route | Middleware | App.Service | Record<string, Route | Middleware>
		>[]
	) {
		for (const route of routes) {
			if (route instanceof Route) {
				this.#trie.add(route);
				this.#routes.push(route);
			} else if (mount in route) {
				this.use(
					route[mount]({
						routes: this.#routes,
						fetch: this.fetch,
						find: (method, pathname) =>
							this.#trie.find(App.#match(method) + pathname)?.route,
					}),
				);
			} else if (Array.isArray(route)) {
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
	readonly fetch = async (resource: RequestInfo | URL, options?: App.Fetch) => {
		let init: RequestInit | undefined;
		if (options)
			for (const key in options) {
				if (key === "ip") continue;
				const { ip, ...rest } = options;
				init = rest;
				break;
			}
		const c = new Context(
			resource instanceof Request && !init
				? resource
				: new Request(resource, init),
			this.#options,
			options?.ip,
		);

		return Context.compose(
			Object.assign(
				c,
				// match
				this.#trie.find(App.#match(c.req.method) + c.url.pathname),
			),
			this.#global.concat(c.route?.middleware ?? []),
		);
	};

	/**
	 * @param method Request method
	 * @returns Method to match routes with, GET finds the route for HEAD
	 */
	static #match(method: string) {
		return method === Method.head ? Method.get : method;
	}

	/** Basic CSRF middleware */
	static #csrf(c: Middleware.Context, next: Middleware.Next) {
		const site = c.req.headers.get(Header.name.fetch);
		const origin = c.req.headers.get(Header.name.origin);

		if (
			c.req.method === Method.get ||
			c.req.method === Method.head ||
			site === "same-origin" ||
			origin === c.url.origin ||
			(c.route && crossOrigin.has(c.route)) ||
			// browsers send at least one, so without cookies this is not a browser,
			// for example an MCP client
			(site === null &&
				origin === null &&
				!c.req.headers.has(Header.name.cookie))
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

			const slash = c.url.pathname.endsWith("/");

			if (mode === "always" && !slash) {
				c.url.pathname += "/";
				c.redirect(c.url, 308);
			} else if (mode === "never" && c.url.pathname !== "/" && slash) {
				c.url.pathname = c.url.pathname.slice(0, -1);
				c.redirect(c.url, 308);
			}
		};
	}
}
