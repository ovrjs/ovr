import { type App, agents, mount } from "../app/index.js";
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

	/** Largest request body */
	static readonly #limit = Size.mb;

	/** Largest response an agent reads from a route */
	static readonly #output = 4 * Size.mb;

	/** Redirects followed after a tool call */
	static readonly #redirects = 5;

	readonly #options: Mcp.Options & { path: string };

	/** App the endpoint is mounted on */
	#app?: App.Mount;

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

		if (auth) {
			// protected resource metadata, RFC 9728
			const metadata: Middleware = (c) => {
				c.res.headers.set("access-control-allow-origin", "*");
				c.json({
					resource: new URL(path, c.url).href,
					authorization_servers: [auth[agents].origin],
					bearer_methods_supported: ["header"],
					resource_name: this.#options.name ?? c.url.host,
				});
			};

			routes.push(
				Route.get(`/.well-known/oauth-protected-resource${path}`).use(metadata),
			);

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
			if (origin !== null && origin !== c.url.origin)
				throw new RpcError(-32600, "Invalid origin", 403);

			const session = await this.#authorize(c);
			if (session === undefined) return;

			const message = await this.#read(c);
			if (!("id" in message)) {
				// notification
				c.res.status = 202;
				return;
			}

			id = message.id as Id;
			const method = message.method as string;
			const params = (message.params ?? {}) as Json;
			const meta = (params._meta ?? {}) as Json;
			const version = meta[`${Mcp.#meta}protocolVersion`];
			const header = c.req.headers.get("mcp-protocol-version");

			if (method === "initialize") {
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
			} else this.#validate(c, method, params, version, header);

			const { ttlMs, cacheScope, ...result } = await this.#dispatch(
				c,
				method,
				params,
				session,
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
							_meta: { [`${Mcp.#meta}serverInfo`]: this.#info(c) },
						},
			});
		} catch (error) {
			if (!(error instanceof RpcError)) throw error;

			c.json(
				{
					jsonrpc: "2.0",
					id,
					error: {
						code: error.code,
						message: error.message,
						...(error.data === undefined ? {} : { data: error.data }),
					},
				},
				error.status,
			);
		}
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

		const length = Number(c.req.headers.get("content-length"));
		const bytes =
			length > Mcp.#limit
				? undefined
				: await Codec.read(c.req.body, Mcp.#limit);
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
	 * its body.
	 *
	 * @param c Request context
	 * @param method JSON-RPC method
	 * @param params Request params
	 * @param version Protocol version from `_meta`
	 * @param header `MCP-Protocol-Version` header
	 */
	#validate(
		c: Context,
		method: string,
		params: Json,
		version: unknown,
		header: string | null,
	) {
		const mismatch = (message: string) =>
			new RpcError(-32020, `Header mismatch: ${message}`, 400);

		if (typeof version !== "string" || !Mcp.#versions.includes(version))
			throw new RpcError(-32022, "Unsupported protocol version", 400, {
				supported: [...Mcp.#versions, ...Mcp.#legacy],
				requested: typeof version === "string" ? version : header,
			});

		if (header !== version)
			throw mismatch("MCP-Protocol-Version does not match the request");

		if (c.req.headers.get("mcp-method") !== method)
			throw mismatch("Mcp-Method does not match the request method");

		const name =
			method === "tools/call" || method === "prompts/get"
				? params.name
				: method === "resources/read"
					? params.uri
					: undefined;

		if (name !== undefined) {
			let value = c.req.headers.get("mcp-name");
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
			...(this.#options.instructions
				? { instructions: this.#options.instructions }
				: {}),
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
				return {};
			case "tools/list":
				return {
					tools: Array.from(this.#list().values(), (tool) => tool.definition),
					...cache,
				};
			case "tools/call":
				return this.#call(c, params, session);
			case "resources/list":
				return {
					resources: this.#pages(false).map((route) => ({
						uri: new URL(route.pattern, c.url).href,
						name: route.pattern,
						...(route.description ? { description: route.description } : {}),
						mimeType: Mime.type.md,
					})),
					...cache,
				};
			case "resources/templates/list":
				return {
					resourceTemplates: this.#pages(true).map((route) => ({
						uriTemplate: new URL(
							route.pattern.replace(parameters, (_, name?: string) =>
								name ? `{${name}}` : "{+wildcard}",
							),
							c.url,
						).href
							.replaceAll("%7B", "{")
							.replaceAll("%7D", "}"),
						name: route.pattern,
						...(route.description ? { description: route.description } : {}),
						mimeType: Mime.type.md,
					})),
					...cache,
				};
			case "resources/read":
				return this.#resource(c, params, session);
			default:
				throw new RpcError(-32601, "Method not found", 404);
		}
	}

	/**
	 * @param templates Pages with parameters
	 * @returns GET routes agents can read
	 */
	#pages(templates: boolean) {
		return this.#app!.routes.filter(
			(route) =>
				route.method === Method.get &&
				route.description &&
				/[:*]/.test(route.pattern) === templates,
		);
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
					},
					// no destructiveHint, so clients treat any tool that writes as one
					// that may need confirming
					annotations: { readOnlyHint: read, openWorldHint: false },
				},
			});
		}

		return tools;
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

		const missing = [...tool.params.keys()].filter(
			(param) =>
				typeof args[param] !== "string" && typeof args[param] !== "number",
		);
		if (missing.length)
			return Mcp.#error(`Missing required parameter: ${missing.join(", ")}`);

		// reported like the form's issues, where a browser would get a 404
		const issues: { path: string; message: string }[] = [];
		for (const [param, key] of tool.params) {
			const result = tool.route.paramSchemas?.[key]?.parse(String(args[param]));
			for (const issue of result?.issues ?? [])
				issues.push({ path: param, message: issue.message });
		}
		if (issues.length) return Mcp.#error(Mcp.#issues(issues));

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
			return Mcp.#error(`Parameters do not match ${route.pattern}`);
		}

		const url = new URL(pathname, c.url.origin);
		// a more specific pattern could select another route
		if (this.#app!.find(route.method, url.pathname) !== route)
			return Mcp.#error(`Parameters do not match ${route.pattern}`);

		const read = route.method === Method.get;
		const body = new FormData();

		for (const [name, value] of Object.entries(args)) {
			if (tool.params.has(name)) continue;
			for (const item of Array.isArray(value) ? value : [value]) {
				if (item == null || item === false) continue;
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
			new Request(url, {
				method: route.method,
				headers: this.#headers(c),
				signal: c.req.signal,
				...(read ? {} : { body }),
			}),
			session,
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
	async #resource(c: Context, params: Json, session: unknown) {
		let url: URL;
		try {
			url = new URL(String(params.uri));
		} catch {
			throw new RpcError(-32602, "Invalid resource URI");
		}
		if (!this.#readable(c, url))
			throw new RpcError(-32002, "Resource not found");

		const req = new Request(url, {
			headers: this.#headers(c),
			signal: c.req.signal,
		});
		const call: Parameters<typeof agent.set>[1] = {
			session,
			tool: this.#tool(c),
		};
		agent.set(req, call);
		const res = await this.#app!.fetch(req, { ip: c.ip });

		// the page's form has issues, such as a search with invalid parameters
		if (call.issues) {
			await res.body?.cancel();
			throw new RpcError(-32602, Mcp.#issues(call.issues));
		}

		const text = await Mcp.#text(res);

		if (res.status === 404) throw new RpcError(-32002, "Resource not found");
		if (!res.ok)
			throw new RpcError(-32603, `${res.status} ${text || res.statusText}`);

		const [type] = Header.shift(res.headers.get(Header.name.type));

		return {
			contents: [{ uri: url.href, mimeType: type ?? Mime.type.md, text }],
		};
	}

	/**
	 * @param c Request context
	 * @returns The name of the tool a form submits to, so the page an agent
	 * reads points to the tool instead of repeating its fields
	 */
	#tool(c: Context) {
		return (method: string, action: URL) =>
			action.origin === c.url.origin && !action.username && !action.password
				? this.#app!.find(method, action.pathname)?.tool?.name
				: undefined;
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
		const route = this.#app!.find(Method.get, url.pathname);
		return Boolean(route?.description);
	}

	/**
	 * @param res Response from a route
	 * @returns The body, bounded in size
	 */
	static async #text(res: Response) {
		const bytes = await Codec.read(res.body, Mcp.#output);
		if (!bytes) throw new RpcError(-32603, "Response too large");
		return Codec.decode(bytes);
	}

	/**
	 * @param c Request context
	 * @returns Headers for requests an agent makes
	 */
	#headers(c: Context) {
		return {
			accept: Mime.type.md,
			origin: c.url.origin,
			"sec-fetch-site": "same-origin",
		};
	}

	/**
	 * Fetches from the app as the agent, following same-origin redirects.
	 *
	 * @param c Request context
	 * @param req Request to make
	 * @param session Session the token authorizes
	 * @returns Tool result
	 */
	async #fetch(c: Context, req: Request, session: unknown) {
		let redirected: URL | undefined;

		for (let i = 0; ; i++) {
			const call: Parameters<typeof agent.set>[1] = {
				session,
				tool: this.#tool(c),
			};
			agent.set(req, call);
			const res = await this.#app!.fetch(req, { ip: c.ip });

			// the form's issues, instead of the redirect back to it
			if (call.issues) {
				await res.body?.cancel();
				return Mcp.#error(Mcp.#issues(call.issues));
			}

			const location = res.headers.get(Header.name.loc);

			if (location && res.status >= 300 && res.status < 400) {
				await res.body?.cancel();
				const next = new URL(location, req.url);

				if (!this.#readable(c, next) || i === Mcp.#redirects) {
					return {
						content: [
							{
								type: "text",
								// another site is where the app sends the user, such as a
								// checkout, but the address of a page of this app that agents
								// cannot read stays private, with any token in it
								text:
									next.origin !== c.url.origin
										? `Redirected to ${next.href}`
										: this.#readable(c, next)
											? `Redirected to ${next.pathname}${next.search}`
											: "Redirected",
							},
						],
						isError: false,
					};
				}

				redirected = next;
				req = new Request(next, {
					headers: this.#headers(c),
					signal: c.req.signal,
				});
				continue;
			}

			const text = await Mcp.#text(res);
			const lines = [
				...(redirected
					? [`Redirected to ${redirected.pathname}${redirected.search}`]
					: []),
				...(res.ok ? [] : [`${res.status} ${res.statusText}`.trim()]),
				...(text ? [text] : []),
			];

			return {
				content: [{ type: "text", text: lines.join("\n\n") }],
				isError: !res.ok,
			};
		}
	}

	/**
	 * @param issues Form issues `c.data()` recorded
	 * @returns Message for the agent with each field's issue
	 */
	static #issues(issues: readonly unknown[]) {
		return `422 Unprocessable Content\n\n${JSON.stringify({ issues })}`;
	}

	/**
	 * @param text Error message for the agent
	 * @returns Tool error result
	 */
	static #error(text: string) {
		return { content: [{ type: "text", text }], isError: true };
	}
}
