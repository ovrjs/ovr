import { Context } from "../context/index.js";
import type { Middleware } from "../middleware/index.js";
import {
	Limit,
	Malformed,
	type Multipart,
	Unsupported,
	memory,
} from "../multipart/index.js";
import { Route, freeze } from "../route/index.js";
import { Trie } from "../trie/index.js";
import { Header, Method, Mime, type Util } from "../util/index.js";

/** Internal protocol for services that `app.use` mounts, such as `Auth`. */
export const mount = Symbol("mount");

/** Asks an authorization service for the routes agents sign in with, see `Mcp` */
export const agents = Symbol("agents");

/** Routes that accept cross-origin requests without cookies, such as OAuth endpoints. */
export const crossOrigin = new WeakSet<Route>();

/**
 * Routes that run without the app's global middleware, such as an MCP
 * endpoint, which makes its own request to the app for each call.
 */
export const direct = new WeakSet<Route>();

export namespace App {
	/** What a service can use from the app it is mounted on. */
	export interface Mount {
		/** Every route the app has, including ones added later */
		readonly routes: readonly Route[];

		/** The app's request handler */
		readonly fetch: App["fetch"];

		/** Most memory a request body may take, the app's `form.memory` */
		readonly memory: number;

		/**
		 * @param method Request method
		 * @param pathname URL pathname
		 * @returns The route a request would run and its parameters, before
		 * running it
		 */
		find(
			method: string,
			pathname: string,
		): { route: Route; params: Record<string, string> } | undefined;
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

	/** Routes by tool name, agents call each by its own */
	readonly #tools = new Map<string, Route>();

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
			this.#global.push(this.#createTrailingSlash(this.#options.trailingSlash));
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
				// final from here, so its tool name and middleware stay as checked
				route[freeze]();
				const { tool } = route;
				if (tool) {
					const other = this.#tools.get(tool.name);
					if (other && other !== route)
						throw new TypeError(
							`Tool name "${tool.name}" is used by ${other.method} ${other.pattern} and ${route.method} ${route.pattern}, change one of their patterns.`,
						);
					this.#tools.set(tool.name, route);
				}

				this.#trie.add(route);
				this.#routes.push(route);
			} else if (mount in route) {
				this.use(
					route[mount]({
						routes: this.#routes,
						fetch: this.fetch,
						memory: this.#options.form?.memory ?? memory,
						find: (method, pathname) =>
							this.#find(method, pathname) ?? undefined,
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

		try {
			return await Context.compose(
				Object.assign(c, this.#find(c.req.method, c.url.pathname)),
				// a route's body errors are answered before global middleware
				// sees them, so middleware that catches errors gets only the app's
				c.route
					? direct.has(c.route)
						? c.route.middleware
						: [...this.#global, App.#body, ...c.route.middleware]
					: this.#global,
			);
		} catch (error) {
			// from global middleware that read the body itself
			const answer = App.#mistake(error);
			if (!answer) throw error;

			// with the headers middleware set before it, such as for CORS
			const headers = new Headers(c.res.headers);
			headers.set(Header.name.type, Header.utf8(Mime.type.text));

			return new Response(answer[1], { status: answer[0], headers });
		}
	};

	/**
	 * @param method Request method, GET finds the route for HEAD
	 * @param pathname URL pathname
	 * @returns The matched route and its decoded parameters
	 */
	#find(method: string, pathname: string) {
		const match = this.#trie.find(
			(method === Method.head ? Method.get : method) + pathname,
		);

		if (match)
			for (const name in match.params)
				match.params[name] = App.#decode(match.params[name]!, name === "*");

		return match;
	}

	/**
	 * @param error Error from reading a request body
	 * @returns The status and message for a body the client got wrong,
	 * `undefined` for any other error, which is the app's
	 */
	static #mistake(error: unknown): [number, string] | undefined {
		if (error instanceof Limit) return [413, error.message];
		if (error instanceof Unsupported)
			return [415, "Unsupported Media Type: send multipart/form-data"];
		if (error instanceof Malformed)
			return [400, `Bad Request: ${error.message}`];
	}

	/** Answers a body the client got wrong, where the route read it */
	static async #body(c: Middleware.Context, next: Middleware.Next) {
		try {
			await next();
		} catch (error) {
			const answer = App.#mistake(error);
			if (!answer) throw error;
			c.text(answer[1], answer[0]);
		}
	}

	/**
	 * @param value Matched parameter, as the URL encodes it
	 * @param wildcard The value is a wildcard's path
	 * @returns The decoded value, or the value as sent when it is malformed
	 */
	static #decode(value: string, wildcard: boolean) {
		// a wildcard is relative to its route, so `/files//etc/passwd` cannot
		// make it an absolute path
		if (wildcard) value = value.replace(/^\/+/, "");
		if (!value.includes("%")) return value;

		try {
			if (!wildcard) return decodeURIComponent(value);

			// a wildcard is a path, so encoded separators stay encoded and a
			// request cannot add segments to it, such as `..%2Fsecret`
			return value
				.split(/(%2F|%5C)/i)
				.map((part, i) => (i % 2 ? part : decodeURIComponent(part)))
				.join("");
		} catch {
			return value;
		}
	}

	/** Basic CSRF middleware */
	static #csrf(c: Middleware.Context, next: Middleware.Next) {
		const { headers, method } = c.req;
		const site = headers.get(Header.name.fetch);
		const origin = headers.get(Header.name.origin);

		if (
			method === Method.get ||
			method === Method.head ||
			site === "same-origin" ||
			origin === c.url.origin ||
			(c.route && crossOrigin.has(c.route)) ||
			// browsers send at least one, so without cookies this is not a browser,
			// for example an agent submitting a form
			(site === null && origin === null && !headers.has(Header.name.cookie))
		) {
			return next();
		}

		c.text("Forbidden", 403);
	}

	/**
	 * Redirect a request no route matched to the other spelling of its path,
	 * with or without the trailing slash, when a route matches that.
	 *
	 * @returns Trailing slash middleware
	 */
	#createTrailingSlash(mode: App.Options.TrailingSlash) {
		return async (c: Context, next: Middleware.Next) => {
			await next();

			// a route answered, its handler has already run
			if (c.route || (c.res.status && c.res.status !== 404)) return;

			const { pathname } = c.url;
			const slash = pathname.endsWith("/");
			const other =
				mode === "always" && !slash
					? pathname + "/"
					: mode === "never" && pathname !== "/" && slash
						? pathname.slice(0, -1)
						: undefined;

			if (!other || !this.#find(c.req.method, other)) return;

			c.url.pathname = other;
			c.redirect(c.url, 308);
		};
	}
}
