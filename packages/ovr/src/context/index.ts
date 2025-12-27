import type { App } from "../app/index.js";
import { Auth } from "../auth/index.js";
import { Cookie } from "../cookie/index.js";
import { type Middleware } from "../middleware/index.js";
import { Multipart } from "../multipart/index.js";
import { Render } from "../render/index.js";
import { Route } from "../route/index.js";
import { type Trie } from "../trie/index.js";
import { Hash, Header, Method, Mime } from "../util/index.js";

/** Properties to build the final `Response` with once middleware has run. */
class PreparedResponse {
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
	headers = new Headers();
}

export namespace Context {
	// gives users access to Middleware.Context.Cookie.Options
	export type Cookie = InstanceType<typeof Cookie>;
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
	readonly res = new PreparedResponse();

	/** Get, set, and delete cookies. */
	readonly cookie = new Cookie(this);

	/** Forwarded app options */
	readonly #options: App.Options;

	/** Cached auth instance */
	#auth?: Auth;

	/**
	 * Creates a new `Context` with the current `Request`.
	 *
	 * @param req Request
	 */
	constructor(req: Request, options: App.Options) {
		this.req = req;
		this.url = new URL(req.url);
		this.#options = options;
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
		this.res.headers.set(Header.type, Header.utf8(Mime.html));
	}

	/**
	 * Creates a JSON response.
	 *
	 * @param data passed into JSON.stringify to create the body
	 * @param status [HTTP response status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
	 */
	json<D>(data: D extends bigint ? never : D, status?: number) {
		this.res.body = JSON.stringify(data);
		this.res.status = status;
		this.res.headers.set(Header.type, Mime.json);
	}

	/**
	 * Creates a plain text response.
	 *
	 * @param body text body
	 * @param status [HTTP response status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
	 */
	text(body: BodyInit | null, status?: number) {
		this.res.body = body;
		this.res.status = status;
		this.res.headers.set(Header.type, Header.utf8(Mime.text));
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
		const etag = `"${Hash.djb2(string)}"`;

		this.res.headers.set(Header.etag, etag);

		if (this.req.headers.get(Header.ifNoneMatch) === etag) {
			this.res.body = null;
			this.res.status = 304;

			return true;
		}

		return false;
	}

	/**
	 * Parse multipart requests.
	 *
	 * @yields Multipart request `Part`(s)
	 *
	 * @example
	 *
	 * ```ts
	 * import { Route } from "ovr";
	 *
	 * const post = Route.post(async (c) => {
	 * 	for await (const part of c.form()) {
	 * 		if (part.name === "email") {
	 * 			// ...
	 * 		}
	 * 	}
	 * })
	 * ```
	 */
	form(options?: Multipart.Options) {
		return new Multipart(
			this.req,
			Object.assign({}, this.#options.form, options),
		);
	}

	get auth() {
		if (!this.#options.auth) throw new Error("Set App.Options.auth to enable");

		return (this.#auth ??= new Auth(this, this.#options.auth));
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
			const [mime] = Header.shift(this.res.headers.get(Header.type));

			this.res.body = Render.stream(r, {
				// other defined types are safe
				safe: Boolean(mime && !Mime.markup(mime)),
			});

			if (!mime) {
				// default to HTML
				this.res.headers.set(Header.type, Header.utf8(Mime.html));
			}

			// do not overwrite/remove status - that way user can set it before returning
		}
	}

	/**
	 * Composes a stack of `middleware` into a `Response`.
	 *
	 * @param c Context
	 * @param middleware stack to compose
	 * @returns constructed `Response`
	 */
	static async compose(c: Context, middleware: Middleware[]) {
		await c.#run(middleware);

		if (c.req.method === Method.head) {
			if (c.res.body instanceof ReadableStream) {
				// cancel unused stream to prevent leaks
				await c.res.body.cancel(Method.head);
			}

			c.res.body = null;
		}

		return new Response(
			c.res.body,
			// prevents users from setting the response during the stream
			Object.freeze(c.res),
		);
	}
}
