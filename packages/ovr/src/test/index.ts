import { type App, agents } from "../app/index.js";
import { auths, grant } from "../auth/index.js";
import { Context } from "../context/index.js";
import { type Field, entries, forms, sent } from "../form/index.js";
import { endpoints, version } from "../mcp/index.js";
import { type ExtractParams, type Route, tooled } from "../route/index.js";
import { Header, Method, Mime } from "../util/index.js";

export namespace Tester {
	/** Who the tester is */
	export type Options = {
		/** App to test */
		readonly app: App;

		/**
		 * ID of the user to act as, who is signed in by the app's `Auth` without
		 * a passkey. The account is the test's to create first. Signed out
		 * without one.
		 */
		readonly user?: string;
	};

	/**
	 * Values of a route's fields by name, as its form takes them: an array of
	 * rows for a list, and a `File` for a file field. A value is not checked,
	 * so a test can send one the route refuses.
	 *
	 * @template Shape Form field shape
	 */
	export type Data<Shape extends Field.Shape> = [Field.Shape] extends [Shape]
		? // a route without fields takes none
			{ readonly [name: string]: never }
		: Field.Value.Initial<Shape>;

	/**
	 * What to request a route with.
	 *
	 * @template Pattern Route pattern
	 * @template Shape Form field shape
	 */
	export type Init<
		Pattern extends string,
		Shape extends Field.Shape,
	> = Route.URLOptions<ExtractParams<Pattern>> & {
		/**
		 * Values of the route's fields, sent as its form sends them: in the body,
		 * or in the search for a GET route
		 */
		readonly data?: Data<Shape>;
	};

	/**
	 * A tool's arguments: the route's parameters, `wildcard` for `*`, and its
	 * fields. A file is an object with its `name` and its `text` or `base64`,
	 * as an agent sends it.
	 *
	 * @template Pattern Route pattern
	 * @template Shape Form field shape
	 */
	export type Arguments<Pattern extends string, Shape extends Field.Shape> = {
		readonly [
			K in keyof ExtractParams<Pattern> as K extends "*" ? "wildcard" : K
		]: Route.URLParam;
	} & ([Field.Shape] extends [Shape] ? unknown : Field.Value.Initial<Shape>);

	/** One part of what a tool answered with */
	export type Content =
		| { readonly type: "text"; readonly text: string }
		| {
				readonly type: "image" | "audio";
				readonly data: string;
				readonly mimeType: string;
		  }
		| {
				readonly type: "resource";
				readonly resource: {
					readonly uri: string;
					readonly mimeType?: string;
					readonly text?: string;
					readonly blob?: string;
				};
		  }
		| {
				readonly type: "resource_link";
				readonly uri: string;
				readonly name: string;
				readonly mimeType?: string;
		  };

	/** A tool's result, as the agent receives it */
	export type Result = {
		/** What the agent reads: text, then any file the route answered with */
		readonly content: readonly Content[];

		/** The call failed, and the text says why, such as a field's issue */
		readonly isError: boolean;

		/** The object a route answered with as JSON */
		readonly structuredContent?: Readonly<Record<string, unknown>>;
	};
}

/**
 * Uses an app as one person does, and as the agent they connected, to test
 * it without a browser, a passkey, or an agent. Each request runs through the
 * whole app.
 *
 * ```ts
 * const tester = new Tester({ app, user: "user-1" });
 *
 * // as the person: the route's own request, signed in
 * const saved = await tester.fetch(create, { data: { title: "Chili" } });
 *
 * // as their agent: a tool call through the MCP endpoint
 * const result = await tester.call(create, { title: "Chili" });
 * ```
 */
export class Tester {
	/** The agent `call` connects, as `auth.agents(c)` lists it */
	static readonly #agent = { id: "https://tester.test", name: "Tester" };

	/** The app requests are sent to */
	readonly #app: App;

	/** ID of the user it signs in as, signed out without one */
	readonly #user: string | undefined;

	/** Cookies the app set, by name */
	readonly #cookies = new Map<string, { value: string; path: string }>();

	/** Signing in, once, before the first request */
	#signedIn?: Promise<void>;

	/** The agent's access token, once it is connected */
	#token?: Promise<string>;

	/** @param options Who the tester is */
	constructor(options: Tester.Options) {
		this.#app = options.app;
		this.#user = options.user;
	}

	/** The `Auth` the app uses, which signs the user in */
	get #auth() {
		return auths.get(this.#app.fetch);
	}

	/** Where requests are made to: the origin people sign in at */
	get #origin() {
		return this.#auth?.[agents].origin ?? "http://localhost";
	}

	/**
	 * Request a route as the person does in a browser: with their cookies, and
	 * a form's fields sent as the form sends them. A redirect is not followed:
	 * request its `location` to see the page it leads to.
	 *
	 * ```ts
	 * const saved = await tester.fetch(create, { data: { title: "Chili" } });
	 * const page = await tester.fetch(saved.headers.get("location")!);
	 * ```
	 *
	 * @param resource Route to request, or a path of the app, such as a
	 * redirect's `location`
	 * @param init The route's parameters, search, and field values
	 * @returns The app's response
	 */
	readonly fetch: {
		<Pattern extends string, Shape extends Field.Shape>(
			resource: Route<Pattern, any, Shape, any>,
			...[init]: keyof ExtractParams<Pattern> extends never
				? [Tester.Init<Pattern, Shape>?]
				: [Tester.Init<Pattern, Shape>]
		): Promise<Response>;
		(resource: string): Promise<Response>;
	} = async (
		resource: Route | string,
		init?: Tester.Init<string, any>,
	): Promise<Response> => {
		await this.#signIn();

		const route = typeof resource === "string" ? undefined : resource;
		const method = route?.method ?? Method.get;
		const read = method === Method.get || method === Method.head;
		const url = new URL(
			route ? route.url(init as never) : (resource as string),
			this.#origin,
		);
		if (url.origin !== this.#origin)
			throw new TypeError(`${url.href} is not a page of the app`);

		// a form without fields, such as a delete, still sends a body
		const body = read ? undefined : new FormData();
		const shape = route && forms.get(route)?.shape;

		for (const [name, value] of Object.entries(init?.data ?? {})) {
			const field =
				shape && Object.hasOwn(shape, name) ? shape[name] : undefined;

			for (const [at, item] of entries(field, name, value)) {
				if (!body) url.searchParams.append(at, sent(item));
				else if (item instanceof Blob) body.append(at, item);
				else body.append(at, sent(item));
			}
		}

		const headers = new Headers({
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		});
		const cookie = Array.from(this.#cookies)
			.filter(([, { path }]) => Tester.#within(url.pathname, path))
			.map(([name, { value }]) => `${name}=${value}`)
			.join("; ");
		if (cookie) headers.set(Header.name.cookie, cookie);
		if (body) {
			// as a browser says a form on the app's own page was submitted
			headers.set(Header.name.origin, this.#origin);
			headers.set("sec-fetch-site", "same-origin");
		}

		const res = await this.#app.fetch(
			new Request(url, { method, headers, body: body ?? null }),
		);
		this.#keep(res.headers);

		return res;
	};

	/**
	 * Call a route's tool as the person's agent does: a `tools/call` request
	 * to the app's MCP endpoint, with the token of an agent the person
	 * connected. The agent is named Tester, and `auth.agents(c)` lists it once
	 * it has made a call.
	 *
	 * ```ts
	 * const result = await tester.call(update, { id: "1", title: "Chili" });
	 * ```
	 *
	 * @template Pattern Route pattern
	 * @template Shape Route's fields
	 * @param route A described route
	 * @param args The tool's arguments: the route's parameters and its fields
	 * @returns The tool's result, where `isError` is `true` when the route
	 * refused the call
	 * @throws When the endpoint refuses the request itself, such as without a
	 * signed-in user
	 */
	readonly call = async <Pattern extends string, Shape extends Field.Shape>(
		route: Route<Pattern, any, Shape, any>,
		...[args]: keyof ExtractParams<Pattern> extends never
			? [Tester.Arguments<Pattern, Shape>?]
			: [Tester.Arguments<Pattern, Shape>]
	): Promise<Tester.Result> => {
		const name = route[tooled] ? route.tool.name() : undefined;
		// a description is not part of a route's type
		if (!name)
			throw new TypeError(
				`${route.method} ${route.pattern} has no tool: describe() the route for agents to call it`,
			);

		const path = endpoints.get(this.#app.fetch);
		if (!path) throw new TypeError("The app has no Mcp endpoint to call");
		const endpoint = new URL(path, this.#origin);

		const headers = new Headers({
			[Header.name.type]: Mime.type.json,
			accept: `${Mime.type.json}, text/event-stream`,
			"mcp-protocol-version": version,
			"mcp-method": "tools/call",
			"mcp-name": name,
		});
		if (this.#auth && this.#user !== undefined) {
			this.#token ??= this.#auth[grant](
				this.#user,
				endpoint.href,
				Tester.#agent,
			);
			headers.set("authorization", `Bearer ${await this.#token}`);
		}

		const res = await this.#app.fetch(
			new Request(endpoint, {
				method: Method.post,
				headers,
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: {
						name,
						arguments: args ?? {},
						_meta: {
							"io.modelcontextprotocol/protocolVersion": version,
							"io.modelcontextprotocol/clientInfo": {
								name: Tester.#agent.name,
								version: "1",
							},
							"io.modelcontextprotocol/clientCapabilities": {},
						},
					},
				}),
			}),
		);
		const message = (await res.json()) as {
			result?: Tester.Result;
			error?: { message: string };
		};
		if (!message.result)
			throw new Error(message.error?.message ?? `MCP endpoint: ${res.status}`);

		const { content, isError, structuredContent } = message.result;

		return {
			content,
			isError,
			...(structuredContent && { structuredContent }),
		};
	};

	/** Signs the user in before the first request, as their passkey would. */
	#signIn() {
		return (this.#signedIn ??= (async () => {
			if (this.#user === undefined) return;

			const auth = this.#auth;
			// an app's services are not part of its type
			if (!auth)
				throw new TypeError(
					"The app has no Auth to sign the user in: app.use(auth) before the first request",
				);

			const c = new Context(new Request(this.#origin), {});
			await auth.login(c, this.#user);
			this.#keep(c.res.headers);
		})());
	}

	/**
	 * Keeps the cookies a response sets, and forgets the ones it deletes.
	 *
	 * @param headers Response headers
	 */
	#keep(headers: Headers) {
		for (const line of headers.getSetCookie()) {
			const [pair = "", ...attributes] = line.split(";");
			const at = pair.indexOf("=");
			if (at < 1) continue;
			const name = pair.slice(0, at).trim();
			const value = pair.slice(at + 1).trim();

			let path = "/";
			let expired = false;
			for (const attribute of attributes) {
				const [key = "", setting = ""] = attribute.trim().split("=");
				const lower = key.toLowerCase();
				if (lower === "path" && setting) path = setting;
				else if (lower === "max-age") expired = Number(setting) <= 0;
				else if (lower === "expires")
					expired ||=
						Date.parse(attribute.slice(attribute.indexOf("=") + 1)) <=
						Date.now();
			}

			if (expired) this.#cookies.delete(name);
			else this.#cookies.set(name, { value, path });
		}
	}

	/**
	 * @param pathname Request pathname
	 * @param path A cookie's `Path`
	 * @returns `true` when the cookie is sent with the request
	 */
	static #within(pathname: string, path: string) {
		return (
			pathname === path ||
			pathname.startsWith(path.endsWith("/") ? path : `${path}/`)
		);
	}
}
