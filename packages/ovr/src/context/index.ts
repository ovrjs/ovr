import type { App } from "../app/index.js";
import { Cookie } from "../cookie/index.js";
import { Form as FormSchema } from "../form/index.js";
import { Markdown } from "../markdown/index.js";
import { Markup } from "../markup/index.js";
import type { Middleware } from "../middleware/index.js";
import { Multipart } from "../multipart/index.js";
import { Route } from "../route/index.js";
import type { Trie } from "../trie/index.js";
import { Checksum, Header, Method, Mime, type Util } from "../util/index.js";

/**
 * Requests an agent makes through an MCP tool, with the session its token
 * authorizes. `c.data()` adds the form's issues, which the MCP endpoint
 * returns to the agent instead of following the handler's redirect.
 */
export const agent = new WeakMap<
	Request,
	{
		readonly session?: unknown;
		issues?: readonly { readonly path: string; readonly message: string }[];
		/** Names the tool a form submits to, so a page points to it */
		readonly tool?: (method: string, action: URL) => string | undefined;
	}
>();

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
	status?: number | undefined;

	/**
	 * `Headers` used to create the `Response`.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Headers)
	 */
	headers = new Headers();
}

/** Reads a request's session, set by a mounted `Auth` */
export const sessions = Symbol("sessions");

export namespace Context {
	/** A signed-in user's revocable session. */
	export interface Session {
		/**
		 * Opaque session ID: a browser session's row ID in `auth_sessions`, or
		 * for an agent's tool call, a hash of its access token.
		 */
		readonly id: string;
		/** User ID. */
		readonly user: string;
		/** Time in milliseconds the session ends unless it is used, which renews it. */
		readonly expiration: number;
	}

	/**
	 * Context.data return type.
	 *
	 * Routes without a schema return `null`.
	 *
	 * @template S Form shape
	 */
	export type Result<S extends FormSchema.Shape> = [FormSchema.Shape] extends [
		S,
	]
		? null
		: Util.Prettify<
				FormSchema.Parse.Result<
					S,
					{
						/** URL with invalid field values encoded into a search parameter. */
						readonly url: URL;
					}
				>
			>;
}

/**
 * Request context.
 *
 * @template Params Parameters created from a route match
 * @template Shape Parsed form data shape
 */
export class Context<
	Params extends Record<string, unknown> = Trie.Params,
	Shape extends FormSchema.Shape = FormSchema.Shape,
> {
	/**
	 * Incoming `Request` to the server.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Request)
	 */
	readonly req: Request;
	/** Trusted client IP supplied by the server through App.fetch; never inferred from request headers. */
	readonly ip: string | undefined;

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

	/** `Vary: Accept` is set */
	#varied = false;

	/** Cached result from `data()` to avoid re-reading request bodies. */
	#parsed?: Promise<Context.Result<Shape>>;

	/** Session reader, set by `app.use(auth)` */
	[sessions]?: () => Promise<Context.Session | null>;

	/**
	 * Creates a new `Context` with the current `Request`.
	 *
	 * @param req Request
	 */
	constructor(req: Request, options: App.Options, ip?: string) {
		this.req = req;
		this.ip = ip;
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
		this.res.headers.set(Header.name.type, Header.utf8(Mime.type.html));
	}

	/**
	 * Creates a JSON response.
	 *
	 * @template D Data, not a `bigint`, which JSON cannot represent
	 * @param data passed into JSON.stringify to create the body
	 * @param status [HTTP response status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
	 */
	json<D>(data: D extends bigint ? never : D, status?: number) {
		this.res.body = JSON.stringify(data);
		this.res.status = status;
		this.res.headers.set(Header.name.type, Mime.type.json);
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
		this.res.headers.set(Header.name.type, Header.utf8(Mime.type.text));
	}

	/**
	 * Responds with Markdown when the request asks for Markdown, such as an
	 * agent's, instead of the Markdown written from the page. Use it for a page
	 * that is a Markdown document, so agents read its source.
	 *
	 * ```tsx
	 * if (c.md(post.body)) return;
	 *
	 * return <Post post={post} />;
	 * ```
	 *
	 * @param body Markdown body
	 * @param status [HTTP response status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
	 * @returns `true` if it responded, otherwise the page renders for the browser
	 */
	md(body: BodyInit | null, status?: number) {
		if (!this.#markdown()) return false;

		this.res.body = body;
		this.res.status = status;
		this.res.headers.set(Header.name.type, Header.utf8(Mime.type.md));

		return true;
	}

	/**
	 * Creates a redirect response.
	 *
	 * @template L Location: a URL, or a route without parameters
	 * @param location redirect `Location` header
	 * @param status HTTP status code
	 *
	 * - [301 Moved Permanently](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/301)
	 * - [302 Found](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302) (default)
	 * - [303 See Other](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/303)
	 * - [307 Temporary Redirect](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/307)
	 * - [308 Permanent Redirect](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/308)
	 */
	redirect<L extends string | URL | Route>(
		// a route with parameters needs values, which only route.url() is given
		location: L extends Route<infer P>
			? P extends `${string}${":" | "*"}${string}`
				? never
				: L
			: L,
		status: 301 | 302 | 303 | 307 | 308 = 302,
	) {
		this.res.body = null;
		this.res.status = status;
		this.res.headers.set(
			Header.name.loc,
			location instanceof Route ? location.url() : String(location),
		);
	}

	/**
	 * Generates an etag from a checksum of the string provided.
	 * If the etag matches, sets the response to not modified.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
	 *
	 * @param string string to check
	 * @returns `true` if the etag matches, `false` otherwise
	 */
	etag(string: string) {
		const etag = `"${Checksum.djb2(string)}"`;

		this.res.headers.set(Header.name.etag, etag);

		if (this.req.headers.get(Header.name.none) === etag) {
			this.res.body = null;
			this.res.status = 304;

			return true;
		}

		return false;
	}

	/**
	 * Parse a multipart request.
	 *
	 * _Prefer_ `Context.data()` _when possible to parse
	 * with a type-safe schema._
	 *
	 * @yields Multipart request `Part`(s)
	 * @example
	 *
	 * ```ts
	 * import { Route } from "ovr";
	 *
	 * const post = Route.post("/posts").use(async (c) => {
	 * 	for await (const part of c.form()) {
	 * 		if (part.name === "email") {
	 * 			// ...
	 * 		}
	 * 	}
	 * })
	 * ```
	 */
	form(options?: Multipart.Options) {
		return new Multipart(this.req, { ...this.#options.form, ...options });
	}

	/**
	 * Read the signed-in user's session before returning JSX, or `null` when
	 * nobody is signed in. In an agent's tool call, it is the session of the
	 * user who approved the agent. Requires `app.use(auth)`.
	 *
	 * ```ts
	 * const session = await c.session();
	 * if (!session) return c.redirect("/login", 303);
	 * ```
	 *
	 * @returns The session, or `null`
	 */
	session() {
		if (!this[sessions])
			throw new TypeError("Mount Auth with app.use(auth) to read sessions");
		return this[sessions]();
	}

	/**
	 * Parse route form data: from the search params of a GET or HEAD request,
	 * and from the multipart body of any other.
	 *
	 * @param options Multipart options for requests with a body
	 * @returns Parsed form data with possible invalid redirect URL state
	 */
	async data(options?: Multipart.Options): Promise<Context.Result<Shape>> {
		return (this.#parsed ??= (async () => {
			// GET and HEAD carry their fields in the URL, every other method in its body
			const post =
				this.req.method !== Method.get && this.req.method !== Method.head;
			const form = this.route as Route.Post | undefined;

			if (!form?.parse) return null as Context.Result<Shape>;

			// a body too large or not form data throws, for the handler to answer
			const result = await form.parse(
				post
					? this.form({ parts: form.parts, ...options })
					: this.url.searchParams,
			);

			/**
			 * Add the URL to return to with the encoded invalid state.
			 *
			 * @template R Parse result, with its search parameters
			 */
			const invalid = <R extends { search: FormSchema.Parse.Result.Search }>(
				result: R,
			) => {
				let url = new URL(this.url);

				if (post) {
					const returnParam = url.searchParams.get(FormSchema.params[0]);

					if (returnParam) {
						try {
							const returnUrl = new URL(returnParam, url);

							if (returnUrl.origin === url.origin) url = returnUrl;
						} catch {
							// invalid redirect target
						}
					}
				}

				for (const param of FormSchema.params) url.searchParams.delete(param);

				if (result.search) url.searchParams.set(...result.search[0]);

				return Object.assign(result, { url });
			};

			if (result.issues) {
				this.#agentIssues(result.issues);
				return invalid(result) as Context.Result<Shape>;
			}

			const create = result.invalid;

			return Object.assign(result, {
				invalid: (messages: FormSchema.Parse.Messages<FormSchema.Shape>) => {
					const result = create(messages);
					this.#agentIssues(result.issues);
					return invalid(result);
				},
			}) as Context.Result<Shape>;
		})());
	}

	/**
	 * Agents get the issues directly instead of a redirect to the form.
	 *
	 * @param issues Parse issues
	 */
	#agentIssues(
		issues: readonly { path: readonly PropertyKey[]; message: string }[],
	) {
		const call = agent.get(this.req);
		if (!call) return;

		call.issues = issues.map((issue) => ({
			path: issue.path.map(String).join("."),
			message: issue.message,
		}));
	}

	/**
	 * Dispatches the stack of `middleware` provided.
	 *
	 * @param middleware stack to run
	 * @param i current middleware index (default `0`)
	 * @returns return value of `middleware[i]`
	 */
	async #run(middleware: Middleware<Params, Shape>[], i = 0) {
		const mw = middleware[i];

		if (!mw) return; // end of stack

		const r: unknown = await mw(this, () => this.#run(middleware, i + 1));

		// resolve the return value
		if (r instanceof Response) {
			// overwrite
			this.res.body = r.body;
			this.res.status = r.status;

			// merge, each cookie is its own header, added to ones already set
			for (const [name, header] of r.headers) {
				if (name !== "set-cookie") this.res.headers.set(name, header);
			}
			for (const cookie of r.headers.getSetCookie())
				this.res.headers.append("set-cookie", cookie);
		} else if (r !== undefined) {
			// something to stream
			const [mime] = Header.shift(this.res.headers.get(Header.name.type));

			if (!mime || mime === Mime.type.html) {
				// pages are HTML for browsers and Markdown for agents that ask for it
				if (this.#markdown()) {
					this.res.body = Markdown.stream(r, {
						base: this.url,
						tool: agent.get(this.req)?.tool,
					});
					this.res.headers.set(Header.name.type, Header.utf8(Mime.type.md));
					return;
				}
			}

			this.res.body = Markup.stream(r, {
				// other defined types are not markup, so they are not escaped
				raw: Boolean(mime && !Mime.markup(mime)),
			});

			if (!mime) {
				// default to HTML
				this.res.headers.set(Header.name.type, Header.utf8(Mime.type.html));
			}

			// do not overwrite/remove status - that way user can set it before returning
		}
	}

	/**
	 * The response depends on `Accept` once this is asked, so it varies by it.
	 *
	 * @returns `true` if the request asks for Markdown over HTML
	 */
	#markdown() {
		if (!this.#varied) {
			this.#varied = true;
			this.res.headers.append(Header.name.vary, "Accept");
		}

		const accept = this.req.headers.get(Header.name.accept);
		// only an explicit request, browsers accept */*
		const markdown = Header.quality(accept, Mime.type.md, true);

		return markdown > 0 && markdown >= Header.quality(accept, Mime.type.html);
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
			// `Response` treats an explicitly undefined status as omitted
			Object.freeze(c.res) as ResponseInit,
		);
	}
}
