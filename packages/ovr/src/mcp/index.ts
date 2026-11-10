import { type App, agents, direct, mount } from "../app/index.js";
import { type Context, agent } from "../context/index.js";
import type { Middleware } from "../middleware/index.js";
import { Route, parameters } from "../route/index.js";
import { Schema } from "../schema/index.js";
import { Codec, Header, Method, Mime, Size } from "../util/index.js";

/** JSON-RPC request id */
type Id = string | number | null;

/** JSON object */
type Json = Record<string, unknown>;

/** Tool made from a route */
type Tool = {
	/** Route the tool calls */
	readonly route: Route;

	/** Tool definition sent to clients */
	readonly definition: Json;

	/** Pattern parameters by the argument that fills them, `wildcard` fills `*` */
	readonly params: ReadonlyMap<string, string>;
};

/** JSON-RPC error */
class RpcError extends Error {
	/** JSON-RPC error code */
	readonly code: number;

	/** HTTP status */
	readonly status: number;

	/** Error data */
	readonly data: unknown;

	/**
	 * @param code JSON-RPC error code
	 * @param message Error message
	 * @param status HTTP status
	 * @param data Error data
	 */
	constructor(code: number, message: string, status = 200, data?: unknown) {
		super(message);
		this.code = code;
		this.status = status;
		this.data = data;
	}
}

export namespace Mcp {
	/** MCP server options */
	export type Options = {
		/**
		 * Server name shown in clients.
		 *
		 * @default The app's host
		 */
		readonly name?: string;

		/** Guidance for agents on how to use the app */
		readonly instructions?: string;

		/**
		 * Path of the MCP endpoint.
		 *
		 * @default "/mcp"
		 */
		readonly path?: string;

		/**
		 * Requires agents to sign in, and mounts the OAuth endpoints they sign
		 * in with. The user approves the agent on Auth's `consent` page, and the
		 * agent acts as that user.
		 */
		readonly auth?: Mcp.Auth;
	};

	/** Authorization the MCP endpoint uses, `Auth` implements it */
	export interface Auth {
		/** What the MCP endpoint needs to sign agents in, internal to ovr */
		readonly [agents]: {
			/** Origin of the authorization server */
			readonly origin: string;

			/**
			 * @param c Request context
			 * @param resource MCP endpoint URL the token must be issued for
			 * @returns The token's session, or `null` without a valid token
			 */
			bearer(c: Pick<Context, "req">, resource: string): Promise<unknown>;

			/**
			 * @param app App the endpoint is mounted on
			 * @param resource The endpoint's URL, which tokens are issued for
			 * @returns The endpoints agents sign in with, mounted with the MCP endpoint
			 */
			mount(
				app: App.Mount,
				resource: string,
			): ReturnType<App.Service[typeof mount]>;
		};
	}
}

/**
 * Model Context Protocol endpoint. Agents use the app's routes as tools, and
 * read its pages as Markdown resources.
 *
 * ```ts
 * app.use(new Mcp({ instructions: "Save and organize bookmarks." }));
 * ```
 */
export class Mcp {
	/** Supported protocol versions */
	static readonly #versions = ["2026-07-28"];

	/**
	 * Earlier versions, which start with `initialize`, newest first. Clients
	 * such as ChatGPT's still use them.
	 */
	static readonly #legacy = ["2025-11-25", "2025-06-18"];

	/** `_meta` key prefix */
	static readonly #meta = "io.modelcontextprotocol/";

	/** Largest response an agent reads from a route */
	static readonly #output = 4 * Size.mb;

	/**
	 * Scheme that names a page of an app agents sign in to. An `https` name
	 * says the agent can fetch the page itself, which it cannot without the
	 * user's session, so it reads the page through this endpoint.
	 */
	static readonly #scheme = "page:";

	/** Redirects followed after a tool call */
	static readonly #redirects = 5;

	readonly #options: Mcp.Options & { path: string };

	/** App the endpoint is mounted on */
	#app?: App.Mount;

	/**
	 * The user's language for each request: what the client prefers, passed to
	 * the routes it calls, and what a route answered in
	 */
	readonly #languages = new WeakMap<
		Request,
		{ accept?: string; content?: string }
	>();

	/** @param options MCP server options */
	constructor(options: Mcp.Options = {}) {
		this.#options = { ...options, path: options.path ?? "/mcp" };
	}

	/**
	 * Mounted by `app.use(mcp)`.
	 *
	 * @param app App to serve
	 * @returns The MCP endpoint routes, and the endpoints agents sign in with
	 */
	[mount](app: App.Mount): ReturnType<App.Service[typeof mount]> {
		if (this.#app)
			throw new TypeError("An Mcp endpoint can only be mounted on one app.");
		this.#app = app;
		const { path, auth } = this.#options;

		const routes: Route[] = [
			Route.post(path).use((c) => this.#handle(c)),
			// only POST is used, there are no streams to open or sessions to end
			...[Method.get, "DELETE"].map((method) =>
				new Route(method, path).use((c) => {
					c.res.headers.set("allow", Method.post);
					return c.text("Method Not Allowed", 405);
				}),
			),
		];
		// the endpoint is the way in for agents, not a page of the app: its
		// request is not the app's to handle. The request it makes to a route
		// for the agent is, once, as the agent's user
		for (const route of routes) direct.add(route);

		if (auth) {
			// protected resource metadata, RFC 9728
			// by the configured origin, the one tokens are issued for, and not the
			// request's host, which anyone can choose
			const { origin } = auth[agents];
			const metadata: Middleware = (c) => {
				c.res.headers.set("access-control-allow-origin", "*");
				c.json({
					resource: new URL(path, origin).href,
					authorization_servers: [origin],
					bearer_methods_supported: ["header"],
					resource_name: this.#options.name ?? new URL(origin).host,
				});
			};

			// part of the way in too, an agent reads it before it has a token
			const discovery = Route.get(
				`/.well-known/oauth-protected-resource${path}`,
			).use(metadata);
			direct.add(discovery);
			routes.push(discovery);

			return [
				...routes,
				auth[agents].mount(app, new URL(path, auth[agents].origin).href),
			];
		}

		return routes;
	}

	/** @param c Request context */
	async #handle(c: Context) {
		c.res.headers.set(Header.name.cache, "no-store");

		let id: Id = null;

		try {
			const origin = c.req.headers.get(Header.name.origin);
			if (origin !== null && (origin !== c.url.origin || Mcp.#rebound(c)))
				throw new RpcError(-32600, "Invalid origin", 403);

			const session = await this.#authorize(c);
			if (session === undefined) return;

			const message = await this.#read(c);
			if (!("id" in message)) {
				// notification, answered with no content
				c.res.status = 202;
				c.res.body = null;
				return;
			}

			id = message.id as Id;
			const method = message.method as string;
			const params = (message.params ?? {}) as Json;
			const meta = (params._meta ?? {}) as Json;
			const version = meta[`${Mcp.#meta}protocolVersion`];
			const header = c.req.headers.get("mcp-protocol-version");

			// a request with a version in `_meta` is 2026-07-28's, which removed it
			if (method === "initialize" && version === undefined) {
				// an earlier version's handshake, answered with the requested
				// version when supported, otherwise the newest earlier one
				const requested = params.protocolVersion;
				c.json({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion:
							typeof requested === "string" && Mcp.#legacy.includes(requested)
								? requested
								: Mcp.#legacy[0],
						...this.#server(),
						serverInfo: this.#info(c),
					},
				});
				return;
			}

			// after `initialize`, an earlier version is only in the header
			const legacy =
				version === undefined &&
				header !== null &&
				Mcp.#legacy.includes(header);

			if (legacy) {
				if (method === "server/discover")
					throw new RpcError(-32601, "Method not found", 404);
				// earlier clients need not send them, but sent ones must match, so
				// a proxy routing on them sees the request that runs
				Mcp.#mirror(c, method, params, true);
			} else this.#validate(c, method, params, meta, header);

			const language = this.#language(c, meta, legacy);

			const { ttlMs, cacheScope, ...result } = await this.#dispatch(
				c,
				method,
				params,
				session,
				legacy,
			);

			c.json({
				jsonrpc: "2.0",
				id,
				result: legacy
					? result
					: {
							resultType: "complete",
							ttlMs,
							cacheScope,
							...result,
							_meta: {
								[`${Mcp.#meta}serverInfo`]: this.#info(c),
								...(language.content && {
									[`${Mcp.#meta}contentLanguage`]: language.content,
								}),
							},
						},
			});

			if (language.content) {
				// the language a route answered in, which varies by the preference
				c.res.headers.set("content-language", language.content);
				c.res.headers.append("vary", "accept-language");
			}
		} catch (error) {
			if (!(error instanceof RpcError)) throw error;

			c.json(
				{
					jsonrpc: "2.0",
					id,
					error: { code: error.code, message: error.message, data: error.data },
				},
				error.status,
			);
		}
	}

	/**
	 * DNS rebinding: a site whose name resolves to this machine, so the user's
	 * browser sends its requests here, with the site as both host and origin.
	 * A browser request from this machine for another host is one.
	 *
	 * @param c Request context
	 * @returns `true` when a local client asks for a host that is not local
	 */
	static #rebound(c: Context) {
		const local = (host: string) =>
			host === "localhost" ||
			host.endsWith(".localhost") ||
			/^127\.|^\[?::1\]?$|^\[?::ffff:127\./.test(host);

		return Boolean(c.ip && local(c.ip) && !local(c.url.hostname));
	}

	/**
	 * Reads the user's language preference, which the routes a request calls
	 * receive as `Accept-Language`, as a person's browser sends it.
	 *
	 * @param c Request context
	 * @param meta Request `_meta`
	 * @param legacy An earlier protocol version, where it is only a header
	 * @returns The request's languages, the route's is set once it answers
	 */
	#language(c: Context, meta: Json, legacy: boolean) {
		const valid = (value: unknown): value is string =>
			typeof value === "string" && /^[\w*,;=. -]{1,256}$/.test(value);
		const header = c.req.headers.get("accept-language");
		const stated = legacy ? undefined : meta[`${Mcp.#meta}acceptLanguage`];

		if (stated !== undefined) {
			if (!valid(stated))
				throw new RpcError(-32602, "Invalid acceptLanguage", 400);
			// a proxy may remove the header, but one that is sent must be the same
			if (header !== null && header !== stated)
				throw new RpcError(
					-32020,
					"Header mismatch: Accept-Language does not match the request",
					400,
				);
		}

		const accept = stated ?? (valid(header) ? header : undefined);
		const language: { accept?: string; content?: string } = accept
			? { accept }
			: {};
		this.#languages.set(c.req, language);

		return language;
	}

	/**
	 * @param c Request context
	 * @returns The session, `null` without auth, or `undefined` after responding 401
	 */
	async #authorize(c: Context) {
		const { auth, path } = this.#options;
		if (!auth) return null;

		const session = await auth[agents].bearer(c, new URL(path, c.url).href);
		if (session) return session;

		c.res.headers.set(
			"www-authenticate",
			`Bearer resource_metadata="${new URL(`/.well-known/oauth-protected-resource${path}`, c.url).href}"`,
		);
		c.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: { code: -32001, message: "Unauthorized" },
			},
			401,
		);

		return undefined;
	}

	/**
	 * @param c Request context
	 * @returns Parsed JSON-RPC message
	 */
	async #read(c: Context) {
		const [type] = Header.shift(c.req.headers.get(Header.name.type));
		if (type?.trim() !== Mime.type.json)
			throw new RpcError(-32700, "Expected application/json", 415);

		// read into memory, so within what the app allows a form's body there:
		// a tool's file arguments are in it
		const limit = this.#app!.memory;
		const length = Number(c.req.headers.get("content-length"));
		const bytes =
			length > limit ? undefined : await Codec.read(c.req.body, limit);
		if (!bytes) throw new RpcError(-32600, "Request too large", 413);

		let message: unknown;
		try {
			message = JSON.parse(Codec.decode(bytes));
		} catch {
			throw new RpcError(-32700, "Parse error", 400);
		}

		if (
			!message ||
			typeof message !== "object" ||
			Array.isArray(message) ||
			(message as Json).jsonrpc !== "2.0" ||
			typeof (message as Json).method !== "string" ||
			// MCP request IDs are strings or integers
			("id" in message &&
				typeof message.id !== "string" &&
				!Number.isSafeInteger(message.id))
		) {
			throw new RpcError(-32600, "Invalid request", 400);
		}

		return message as Json;
	}

	/**
	 * Checks the protocol version, and the headers a request must mirror from
	 * its body, for the 2026-07-28 version.
	 *
	 * @param c Request context
	 * @param method JSON-RPC method
	 * @param params Request params
	 * @param meta Request `_meta`, which carries the version and capabilities
	 * @param header `MCP-Protocol-Version` header
	 */
	#validate(
		c: Context,
		method: string,
		params: Json,
		meta: Json,
		header: string | null,
	) {
		const version = meta[`${Mcp.#meta}protocolVersion`];
		const invalid = (field: string) =>
			new RpcError(-32602, `Invalid params: _meta needs ${field}`, 400);

		if (version === undefined) {
			// this version by its header, so what is missing is the field
			if (header !== null && Mcp.#versions.includes(header))
				throw invalid(`${Mcp.#meta}protocolVersion`);
		} else if (typeof version !== "string") {
			throw invalid(`${Mcp.#meta}protocolVersion`);
		} else if (header !== version) {
			// before the version is judged: a proxy routes on the header
			throw new RpcError(
				-32020,
				"Header mismatch: MCP-Protocol-Version does not match the request",
				400,
			);
		}

		if (typeof version !== "string" || !Mcp.#versions.includes(version))
			throw new RpcError(-32022, "Unsupported protocol version", 400, {
				supported: [...Mcp.#versions, ...Mcp.#legacy],
				requested: typeof version === "string" ? version : header,
			});

		const capabilities = meta[`${Mcp.#meta}clientCapabilities`];
		if (
			!capabilities ||
			typeof capabilities !== "object" ||
			Array.isArray(capabilities)
		)
			throw invalid(`${Mcp.#meta}clientCapabilities`);

		Mcp.#mirror(c, method, params);
	}

	/**
	 * Checks the headers a request mirrors from its body.
	 *
	 * @param c Request context
	 * @param method JSON-RPC method
	 * @param params Request params
	 * @param optional Check only the headers that are sent
	 */
	static #mirror(c: Context, method: string, params: Json, optional?: boolean) {
		const mismatch = (message: string) =>
			new RpcError(-32020, `Header mismatch: ${message}`, 400);

		const sent = c.req.headers.get("mcp-method");
		if ((sent !== null || !optional) && sent !== method)
			throw mismatch("Mcp-Method does not match the request method");

		const name =
			method === "tools/call" || method === "prompts/get"
				? params.name
				: method === "resources/read"
					? params.uri
					: undefined;

		if (name !== undefined) {
			let value = c.req.headers.get("mcp-name");
			if (value === null && optional) return;
			const encoded = value && /^=\?base64\?(.*)\?=$/.exec(value);
			if (encoded) {
				try {
					value = Codec.decode(Codec.Base64.decode(encoded[1]!));
				} catch {
					value = null;
				}
			}
			if (value !== name) throw mismatch("Mcp-Name does not match the request");
		}
	}

	/**
	 * @param c Request context
	 * @returns Server name and version
	 */
	#info(c: Context) {
		return {
			name: this.#options.name ?? c.url.host,
			// required by the protocol, and only shown in clients
			version: "1.0.0",
		};
	}

	/** @returns Server capabilities and instructions */
	#server() {
		return {
			capabilities: { tools: {}, resources: {} },
			instructions: this.#options.instructions,
		};
	}

	/**
	 * @param c Request context
	 * @param method JSON-RPC method
	 * @param params Request params
	 * @param session Session the token authorizes
	 * @returns Method result
	 */
	async #dispatch(
		c: Context,
		method: string,
		params: Json,
		session: unknown,
		legacy: boolean,
	): Promise<Json> {
		const cache = { ttlMs: 60_000, cacheScope: "public" };

		switch (method) {
			case "server/discover":
				return {
					supportedVersions: [...Mcp.#versions, ...Mcp.#legacy],
					...this.#server(),
					...cache,
				};
			case "ping":
				// removed in 2026-07-28
				if (legacy) return {};
				throw new RpcError(-32601, "Method not found", 404);
			case "tools/list":
				return {
					tools: Array.from(this.#list().values(), (tool) => tool.definition),
					...cache,
				};
			case "tools/call":
				return this.#call(c, params, session);
			case "resources/list":
			case "resources/templates/list": {
				// pages with parameters are templates
				const templates = method !== "resources/list";
				return {
					[templates ? "resourceTemplates" : "resources"]:
						this.#app!.routes.filter(
							(route) =>
								route.method === Method.get &&
								route.description &&
								/[:*]/.test(route.pattern) === templates,
						).map((route) => {
							const href = this.#name(
								new URL(
									route.pattern.replace(parameters, (_, name?: string) =>
										name ? `{${name}}` : "{+wildcard}",
									),
									c.url,
								),
							);
							return {
								[templates ? "uriTemplate" : "uri"]: templates
									? href.replaceAll("%7B", "{").replaceAll("%7D", "}")
									: href,
								name: route.pattern,
								description: route.description,
								mimeType: Mime.type.md,
							};
						}),
					...cache,
				};
			}
			case "resources/read":
				return this.#resource(c, params, session, legacy);
			default:
				throw new RpcError(-32601, "Method not found", 404);
		}
	}

	/**
	 * Built for each request, so routes mounted after the endpoint are
	 * included. Mounted routes are final, so their tools do not change.
	 *
	 * @returns Tools by name, from the app's current routes
	 */
	#list() {
		const tools = new Map<string, Tool>();

		for (const route of this.#app!.routes) {
			const { tool } = route;
			if (!tool) continue;

			const { name, read } = tool;
			const form = route as Route.Post;
			// names are unique, app.use() throws for two routes sharing one

			const params = new Map(
				Array.from(route.pattern.matchAll(parameters), ([, name]) =>
					name ? [name, name] : ["wildcard", "*"],
				),
			);

			const properties: Json = {};
			const required = new Set<string>();

			if (form.shape) {
				const schema = Mcp.#json(Schema.object(form.shape));
				Object.assign(properties, schema.properties);
				for (const field of (schema.required ?? []) as string[])
					required.add(field);
				// a tool's arguments are JSON, so a file is sent as its contents
				for (const name in form.shape) {
					const field = form.shape[name]!;
					if (field.type === "file")
						properties[name] =
							field.parts > 1
								? { ...(properties[name] as Json), items: Mcp.#file }
								: { ...(properties[name] as Json), ...Mcp.#file };
				}
			}

			for (const [param, key] of params) {
				const schema = route.paramSchemas?.[key];
				properties[param] = schema ? Mcp.#json(schema) : { type: "string" };
				required.add(param);
			}

			tools.set(name, {
				route,
				params,
				definition: {
					name,
					description: tool.description,
					inputSchema: {
						type: "object",
						properties,
						...(required.size ? { required: [...required] } : {}),
						// a form takes only its fields. Other routes are left open: a
						// handler may read the query or the body itself
						...(form.shape && !read && { additionalProperties: false }),
					},
					// no destructiveHint, so clients treat any tool that writes as one
					// that may need confirming
					annotations: { readOnlyHint: read, openWorldHint: false },
				},
			});
		}

		return tools;
	}

	/** A file as a tool argument, for a file field */
	static readonly #file = {
		type: "object",
		description:
			"A file. Send its contents as `text`, or as `base64` when it is not text.",
		properties: {
			name: { type: "string", description: "File name, such as notes.txt" },
			type: { type: "string", description: "Media type, such as text/plain" },
			text: { type: "string" },
			base64: { type: "string", contentEncoding: "base64" },
		},
		required: ["name"],
	};

	/**
	 * @param value Tool argument for a file field
	 * @returns The file, `undefined` when the argument does not describe one
	 */
	static #upload(value: unknown) {
		if (typeof value !== "object" || !value) return;

		const { name, type, text, base64 } = value as Json;
		if (typeof name !== "string" || !name) return;

		const options = typeof type === "string" ? { type } : undefined;

		if (typeof text === "string") return new File([text], name, options);
		if (typeof base64 !== "string") return;

		try {
			return new File([Codec.Base64.decode(base64)], name, options);
		} catch {
			// not base64
		}
	}

	/**
	 * @param schema Schema
	 * @returns JSON Schema for the accepted input
	 */
	static #json(schema: Schema<unknown>) {
		const { $schema: _, ...json } = schema.toJsonSchema({
			io: "input",
			unrepresentable: "any",
		}) as Json;
		return json;
	}

	/**
	 * Calls a route as the agent's user.
	 *
	 * @param c Request context
	 * @param params `tools/call` params
	 * @param session Session the token authorizes
	 * @returns Tool result
	 */
	async #call(c: Context, params: Json, session: unknown) {
		const tool =
			typeof params.name === "string"
				? this.#list().get(params.name)
				: undefined;
		if (!tool) throw new RpcError(-32602, `Unknown tool: ${params.name}`);

		const args = (params.arguments ?? {}) as Json;
		if (typeof args !== "object" || Array.isArray(args))
			throw new RpcError(-32602, "Tool arguments must be an object");

		// reported like the form's issues, where a browser would get a 404
		const issues: { path: string; message: string }[] = [];
		for (const [param, key] of tool.params) {
			const value = args[param];
			for (const { message } of typeof value === "string" ||
			typeof value === "number"
				? (tool.route.paramSchemas?.[key]?.parse(String(value)).issues ?? [])
				: [{ message: "Required field" }])
				issues.push({ path: param, message });
		}
		if (issues.length) return Mcp.#result(Mcp.#issues(issues), true);

		const { route } = tool;
		let pathname: string;
		try {
			pathname = route.url({
				params: Object.fromEntries(
					Array.from(tool.params, ([param, key]) => [key, String(args[param])]),
				),
			} as never);
		} catch (error) {
			// a value such as `..` or `/host` would leave its place in the path,
			// and one with a lone surrogate cannot be encoded
			if (!(error instanceof TypeError || error instanceof URIError))
				throw error;
			return Mcp.#result(`Parameters do not match ${route.pattern}`, true);
		}

		const url = new URL(pathname, c.url.origin);
		// a more specific pattern could select another route
		if (this.#app!.find(route.method, url.pathname)?.route !== route)
			return Mcp.#result(`Parameters do not match ${route.pattern}`, true);

		const read = route.method === Method.get;
		const body = new FormData();

		const { shape } = route as Route.Post;

		if (shape && !read) {
			// named here, the form would only count one part too many
			const unexpected = Object.keys(args).filter(
				(name) => !Object.hasOwn(shape, name) && !tool.params.has(name),
			);
			if (unexpected.length)
				return Mcp.#result(
					Mcp.#issues(
						unexpected.map((path) => ({
							path,
							message: "Unexpected argument",
						})),
					),
					true,
				);
		}
		for (const [name, value] of Object.entries(args)) {
			// a parameter is in the path, and also sent when a field has its name
			if (tool.params.has(name) && !(shape && Object.hasOwn(shape, name)))
				continue;
			const upload =
				!read && shape && Object.hasOwn(shape, name)
					? shape[name]!.type === "file"
					: false;
			for (const item of Array.isArray(value) ? value : [value]) {
				if (item == null || item === false) continue;
				if (upload) {
					const file = Mcp.#upload(item);
					if (!file)
						return Mcp.#result(
							Mcp.#issues([
								{
									path: name,
									message:
										"Expected a file: its name, and its contents as text or base64",
								},
							]),
							true,
						);
					body.append(name, file);
					continue;
				}
				const text =
					item === true
						? "on"
						: typeof item === "object"
							? JSON.stringify(item)
							: String(item);
				if (read) url.searchParams.append(name, text);
				else body.append(name, text);
			}
		}

		return this.#fetch(
			c,
			session,
			url,
			read ? undefined : { method: route.method, body },
		);
	}

	/**
	 * Reads a page as Markdown.
	 *
	 * @param c Request context
	 * @param params `resources/read` params
	 * @param session Session the token authorizes
	 * @returns Resource contents
	 */
	async #resource(c: Context, params: Json, session: unknown, legacy: boolean) {
		let url: URL;
		try {
			url = new URL(String(params.uri));
			// a page by its name, or by its address, as a link in a page gives it
			if (url.protocol === Mcp.#scheme)
				url = new URL(
					url.pathname + url.search + url.hash,
					`${c.url.protocol}//${url.host}`,
				);
		} catch {
			throw new RpcError(-32602, "Invalid resource URI");
		}

		// its own code before 2026-07-28, invalid params since
		const missing = () =>
			new RpcError(legacy ? -32002 : -32602, "Resource not found", 200, {
				uri: String(params.uri),
			});
		// a page read as the user is theirs alone, and may change at any time
		const cache = {
			ttlMs: 0,
			cacheScope: this.#options.auth ? "private" : "public",
		};

		if (!this.#readable(c, url)) throw missing();

		const res = await this.#run(c, session, url);
		// the page's form has issues, such as a search with invalid parameters
		if (typeof res === "string") throw new RpcError(-32602, res);

		if (res.status >= 500) throw await Mcp.#failed(res);

		const { type, live, ...body } = await Mcp.#body(res);
		if (live)
			return {
				contents: [
					{
						uri: this.#name(url),
						mimeType: Mime.type.text,
						text: this.#stream(url),
					},
				],
				...cache,
			};

		if (res.status === 404) throw missing();
		// refused, such as a 403: the request's to change, where a server error
		// above is the app's
		if (!res.ok)
			throw new RpcError(
				-32602,
				`${res.status} ${body.text || res.statusText}`.trim(),
				200,
				{
					uri: String(params.uri),
					status: res.status,
					...(res.headers.has("retry-after") && {
						retryAfter: res.headers.get("retry-after"),
					}),
				},
			);

		return {
			contents: [
				{ uri: this.#name(url), mimeType: type ?? Mime.type.md, ...body },
			],
			...cache,
		};
	}

	/**
	 * @param url A page's address
	 * @returns The page's resource name: its address, or with sign-in the same
	 * host and path as a `page:` URI
	 */
	#name(url: URL) {
		return this.#options.auth
			? `${Mcp.#scheme}//${url.host}${url.pathname}${url.search}${url.hash}`
			: url.href;
	}

	/**
	 * @param url Address of a route that answers with an event stream
	 * @returns What to tell the agent, a stream may never end so it is not read
	 */
	#stream(url: URL) {
		return this.#options.auth
			? `This is a live event stream, which is not read through this connection. It needs the user's sign-in, so the user can open it in their browser: ${url.href}`
			: `This is a live event stream. Request the address yourself to read its events as they arrive, and close the connection to stop: ${url.href}`;
	}

	/**
	 * @param c Request context
	 * @returns The name of the tool a form submits to, so the page an agent
	 * reads points to the tool instead of repeating its fields
	 */
	#tool(c: Context) {
		return (method: string, action: URL) => {
			if (action.origin !== c.url.origin || action.username || action.password)
				return;

			const match = this.#app!.find(method, action.pathname);
			const name = match?.route.tool?.name;
			if (!name) return;

			// the address's parameters, as the arguments the tool takes them by
			const args: Record<string, string> = {};
			for (const param in match.params)
				args[param === "*" ? "wildcard" : param] = match.params[param]!;

			return { name, args };
		};
	}

	/**
	 * @param c Request context
	 * @param url URL to read
	 * @returns `true` if the URL is a page agents can read
	 */
	#readable(c: Context, url: URL) {
		// credentials are no part of a page's address
		if (url.origin !== c.url.origin || url.username || url.password)
			return false;
		const route = this.#app!.find(Method.get, url.pathname)?.route;
		return Boolean(route?.description);
	}

	/** Media types read as text, any other is a file */
	static readonly #texts =
		/^text\/|[/+](?:json|xml)$|^application\/(?:javascript|x-www-form-urlencoded)$/i;

	/**
	 * @param res Response from a route
	 * @returns The body, bounded in size: its text, or a file such as an image
	 * or a PDF in base64
	 */
	static async #body(
		res: Response,
	): Promise<{
		type?: string | null;
		text?: string;
		blob?: string;
		live?: boolean;
	}> {
		const [type] = Header.shift(res.headers.get(Header.name.type));

		if (res.ok && type?.toLowerCase() === "text/event-stream") {
			// not read, it may never end: the route stops here
			await res.body?.cancel();
			return { type, live: true };
		}

		const bytes = await Codec.read(res.body, Mcp.#output);
		if (!bytes) throw new RpcError(-32603, "Response too large");

		if (!type || Mcp.#texts.test(type)) {
			try {
				return { type, text: Codec.decode(bytes) };
			} catch {
				// not text after all
			}
		}

		return {
			type: type || "application/octet-stream",
			blob: Codec.Base64.encode(bytes),
		};
	}

	/**
	 * Requests a page of the app as the agent.
	 *
	 * @param c Request context
	 * @param session Session the token authorizes
	 * @param url URL to request
	 * @param init Method and body
	 * @returns The response, or the form's issues instead of the redirect back to it
	 */
	async #run(c: Context, session: unknown, url: URL, init?: RequestInit) {
		const language = this.#languages.get(c.req);
		const req = new Request(url, {
			...init,
			headers: {
				accept: Mime.type.md,
				origin: c.url.origin,
				"sec-fetch-site": "same-origin",
				...(language?.accept && { "accept-language": language.accept }),
			},
			signal: c.req.signal,
		});
		const call: Parameters<typeof agent.set>[1] = {
			session,
			tool: this.#tool(c),
		};
		agent.set(req, call);
		const res = await this.#app!.fetch(req, { ip: c.ip });
		// the last page read, after any redirects
		const content = res.headers.get("content-language");
		if (language && content) language.content = content;
		if (!call.issues) return res;

		await res.body?.cancel();
		return Mcp.#issues(call.issues);
	}

	/**
	 * Calls the app as the agent, following redirects to pages it can read.
	 *
	 * @param c Request context
	 * @param session Session the token authorizes
	 * @param url URL to request
	 * @param init Method and body
	 * @returns Tool result
	 */
	async #fetch(c: Context, session: unknown, url: URL, init?: RequestInit) {
		let redirected: URL | undefined;
		/** The call writes, so a redirect from it means it was done */
		const wrote = init !== undefined;

		for (let i = 0; ; i++) {
			const res = await this.#run(c, session, url, init);
			if (typeof res === "string") return Mcp.#result(res, true);

			const location = res.headers.get(Header.name.loc);

			if (location && res.status >= 300 && res.status < 400) {
				await res.body?.cancel();
				const next = new URL(location, url);
				const readable = this.#readable(c, next);

				if (readable && i < Mcp.#redirects) {
					url = redirected = next;
					init = undefined;
					continue;
				}

				// another site is where the app sends the user, such as a checkout,
				// but the address of a page of this app that agents cannot read
				// stays private, with any token in it
				return Mcp.#result(
					next.origin !== c.url.origin
						? `Redirected to ${next.href}`
						: readable
							? `Redirected to ${next.pathname}${next.search}`
							: "Redirected",
				);
			}

			// the route answered a write by redirecting, so the write is done. A
			// page it sends to that then fails, such as on a rate limit, must not
			// read as the write failing, or an agent would make it again
			if (redirected && wrote && !res.ok) {
				await res.body?.cancel();
				return Mcp.#result(
					`Redirected to ${redirected.pathname}${redirected.search}, which could not be read: ${Mcp.#status(res)}`,
				);
			}

			if (res.status >= 500) throw await Mcp.#failed(res);

			const { type, text, blob, live } = await Mcp.#body(res);

			if (live)
				return Mcp.#result(
					this.#stream(url),
					false,
					// a link only where the agent can open it
					this.#options.auth
						? undefined
						: {
								type: "resource_link",
								uri: url.href,
								name: url.pathname,
								mimeType: type,
							},
				);

			const [kind] = type?.split("/") ?? [];

			return Mcp.#result(
				[
					redirected &&
						`Redirected to ${redirected.pathname}${redirected.search}`,
					!res.ok && Mcp.#status(res),
					text,
				]
					.filter(Boolean)
					.join("\n\n"),
				!res.ok,
				// a file, as a person would download or see it
				blob === undefined
					? undefined
					: kind === "image" || kind === "audio"
						? { type: kind, data: blob, mimeType: type }
						: {
								type: "resource",
								resource: { uri: this.#name(url), mimeType: type, blob },
							},
			);
		}
	}

	/**
	 * @param res Response that is not a success
	 * @returns Its status, and when to try again if it says, such as a rate limit's
	 */
	static #status(res: Response) {
		const retry = res.headers.get("retry-after");
		return [
			`${res.status} ${res.statusText}`.trim(),
			// seconds, or a date
			retry &&
				`Retry after ${/^\d+$/.test(retry) ? `${retry} seconds` : retry}`,
		]
			.filter(Boolean)
			.join("\n\n");
	}

	/**
	 * A server error is the app's to fix, not something the agent can act on
	 * as it can on a form's issues, so it is a protocol error and not a result.
	 * The app's own error page stays with the app.
	 *
	 * @param res Response the app answered a failure with
	 * @returns The JSON-RPC internal error
	 */
	static async #failed(res: Response) {
		await res.body?.cancel();
		return new RpcError(-32603, "Internal error", 200, { status: res.status });
	}

	/**
	 * @param issues Form issues `c.data()` recorded
	 * @returns Message for the agent with each field's issue
	 */
	static #issues(issues: readonly unknown[]) {
		return `422 Unprocessable Content\n\n${JSON.stringify({ issues })}`;
	}

	/**
	 * @param text Text for the agent
	 * @param isError The call failed
	 * @param file A file the route answered with, after the text if any
	 * @returns Tool result
	 */
	static #result(text: string, isError = false, file?: Json) {
		return {
			content: [
				...(text || !file ? [{ type: "text", text }] : []),
				...(file ? [file] : []),
			],
			isError,
		};
	}
}
