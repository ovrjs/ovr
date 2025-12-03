import { Cookie } from "../cookie/index.js";
import { render } from "../jsx/index.js";
import { type Middleware } from "../middleware/index.js";
import { Parser } from "../multipart/index.js";
import { Route } from "../route/index.js";
import { type Trie } from "../trie/index.js";
import { hash } from "../util/hash.js";
import { contentType } from "../util/header.js";

export namespace Context {
	/** Properties to build the final `Response` with once middleware has run. */
	export type PreparedResponse = {
		/**
		 * `body` used to create the `Response`.
		 *
		 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Response/Response#body)
		 */
		body?: BodyInit | null;

		/**
		 * `status` used to create the `Response`.
		 *
		 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
		 */
		status?: number;

		/**
		 * `Headers` used to create the `Response`.
		 *
		 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Headers)
		 */
		headers: Headers;
	};
}

/**
 * Request context.
 *
 * @template Params Parameters created from a route match
 */
export class Context<Params extends Trie.Params = Trie.Params> {
	/**
	 * Incoming `Request` to the server.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Request)
	 */
	readonly req: Request;

	/**
	 * Parsed `URL` created from `req.url`.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URL)
	 */
	readonly url: URL;

	/** Route pattern parameters */
	readonly params: Params = {} as Params; // set after match

	/** Matched `Route` instance */
	readonly route?: Route;

	/** Contains the arguments to used create the final `Response` */
	readonly res: Context.PreparedResponse = { headers: new Headers() };

	/** Get, set, and delete cookies. */
	readonly cookie = new Cookie(this);

	// for reuse across methods
	static readonly #textHtml = "text/html";
	static readonly #utf8 = "charset=utf-8";
	static readonly #htmlType = `${Context.#textHtml}; ${Context.#utf8}`;

	/**
	 * Creates a new `Context` with the current `Request`.
	 *
	 * @param req Request
	 */
	constructor(req: Request) {
		this.req = req;
		this.url = new URL(req.url);
	}

	/**
	 * Creates an HTML response.
	 *
	 * @param body HTML body
	 * @param status [HTTP response status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
	 */
	html(body: BodyInit | null, status?: number) {
		this.res.body = body;
		this.res.status = status;
		this.res.headers.set(contentType, Context.#htmlType);
	}

	/**
	 * Creates a JSON response.
	 *
	 * @param data passed into JSON.stringify to create the body
	 * @param status [HTTP response status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
	 */
	json(data: unknown, status?: number) {
		this.res.body = JSON.stringify(data);
		this.res.status = status;
		this.res.headers.set(contentType, "application/json");
	}

	/**
	 * Creates a plain text response.
	 *
	 * @param body response body
	 * @param status [HTTP response status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
	 */
	text(body: BodyInit, status?: number) {
		this.res.body = body;
		this.res.status = status;
		this.res.headers.set(contentType, `text/plain; ${Context.#utf8}`);
	}

	/**
	 * Creates a redirect response.
	 *
	 * @param location redirect `Location` header
	 * @param status HTTP status code
	 *
	 * - [301 Moved Permanently](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/301)
	 * - [302 Found](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302) (default)
	 * - [303 See Other](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/303)
	 * - [307 Temporary Redirect](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/307)
	 * - [308 Permanent Redirect](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/308)
	 */
	redirect(location: string | URL, status: 301 | 302 | 303 | 307 | 308 = 302) {
		this.res.body = null;
		this.res.status = status;
		this.res.headers.set("location", String(location));
	}

	/**
	 * Generates an etag from a hash of the string provided.
	 * If the etag matches, sets the response to not modified.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
	 *
	 * @param string string to hash
	 * @returns `true` if the etag matches, `false` otherwise
	 */
	etag(string: string) {
		const etag = `"${hash(string)}"`;

		this.res.headers.set("etag", etag);

		if (this.req.headers.get("if-none-match") === etag) {
			this.res.body = null;
			this.res.status = 304;

			return true;
		}

		return false;
	}

	/**
	 * Parse multi-part form data streams.
	 *
	 * @param memory Memory allocation options
	 * @yields Multipart form data `Part`(s)
	 *
	 * @example
	 *
	 * ```ts
	 * import { Route } from "ovr";
	 *
	 * const post = Route.post(async (c) => {
	 * 	for await (const part of c.data()) {
	 * 		if (part.name === "email") {
	 * 			// ...
	 * 		}
	 * 	}
	 * })
	 * ```
	 */
	async *data(memory?: Parser.Memory) {
		yield* new Parser(this.req, memory).data();
	}

	/**
	 * Dispatches the stack of `middleware` provided.
	 *
	 * @param middleware stack to run
	 * @param i current middleware index (default `0`)
	 * @returns return value of `middleware[i]`
	 */
	async #run(middleware: Middleware<Params>[], i = 0) {
		const mw = middleware[i];

		if (!mw) return; // end of stack

		const r = await mw(
			this, // c
			() => this.#run(middleware, i + 1), // next
		);

		// resolve the return value
		if (r instanceof Response) {
			// overwrite
			this.res.body = r.body;
			this.res.status = r.status;

			// merge
			for (const [name, header] of r.headers) {
				this.res.headers.set(name, header);
			}
		} else if (r !== undefined) {
			// something to stream
			const type = this.res.headers.get(contentType);

			this.res.body = render.stream(r, {
				// other defined types are safe
				safe: Boolean(type && !type.startsWith(Context.#textHtml)),
			});

			if (!type) {
				// default to HTML
				this.res.headers.set(contentType, Context.#htmlType);
			}

			// do not overwrite/remove status - that way user can set it before returning
		}
	}

	/**
	 * Composes a stack of `middleware` into a `Response`.
	 *
	 * @param middleware stack to compose
	 * @returns constructed `Response`
	 */
	async build(middleware: Middleware<Params>[]) {
		await this.#run(middleware);

		if (this.req.method === "HEAD") {
			if (this.res.body instanceof ReadableStream) {
				// cancel unused stream to prevent leaks
				await this.res.body.cancel("HEAD");
			}

			this.res.body = null;
		}

		Object.freeze(this.res);

		return new Response(this.res.body, this.res);
	}
}
