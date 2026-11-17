import { type App, agents, mount } from "../app/index.js";
import { type Context as ContextType, sessions } from "../context/index.js";
import type { Context as View } from "../context/read.js";
import { type Database, references } from "../database/index.js";
import type { Field, Form } from "../form/index.js";
import type { JSX } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import type { Mcp } from "../mcp/index.js";
import type { Middleware } from "../middleware/index.js";
import type { Route } from "../route/index.js";
import type { Schema } from "../schema/index.js";
import type { Table } from "../table/index.js";
import { Codec, noStore } from "../util/index.js";
import { configure } from "./configure.js";
import { Metadata } from "./metadata.js";
import { lifetime, oauth } from "./oauth.js";
import { State } from "./state.js";
import { Storage } from "./storage.js";
import { Token } from "./token.js";

/** Connects an agent without the consent page, see `Auth[grant]`. Internal to ovr. */
export const grant = Symbol("grant");

/**
 * Each app's first `Auth`, by the app's `fetch`. Internal to ovr, for what
 * signs a user in without being given the app's auth.
 */
export const auths = new WeakMap<App["fetch"], Auth<any, any, any, any>>();

export namespace Auth {
	/** Authentication validation issue. */

	/** Request capabilities required while preparing the built-in UI. */
	export type Context = Pick<
		ContextType,
		"url" | "cookie" | "res" | "multipart"
	> & { data: (options?: { payload: number }) => Promise<unknown> };
	/**
	 * Request-scoped UI pieces with application field names preserved.
	 *
	 * @template Shape Registration fields of the users table
	 */
	export interface Forms<Shape extends Field.Shape> {
		/** Creates an account with a passkey, from the users table's fields. */
		readonly register: {
			readonly Form: Route.Form<string>;
			readonly Field: Form.Bound<Shape>["Field"];
			readonly Fields: Form.Bound<Shape>["Fields"];
			readonly Issue: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		/** Signs in with a passkey. */
		readonly login: {
			readonly Form: Route.Form<string>;
			readonly Issue: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		/**
		 * Adds another passkey to the account signed in, such as on a new
		 * device, and returns to the page it is on.
		 */
		readonly add: {
			readonly Form: Route.Form<string>;
			readonly Issue: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		/**
		 * Signs in with a link from `auth.link`, on the authentication `page`
		 * the link opens. It is a button, so only a person uses the link, and
		 * renders nothing on a page opened without one.
		 */
		readonly link: {
			readonly Form: (props: JSX.IntrinsicElements["form"]) => JSX.Element;
			readonly Issue: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		/** Signs out. */
		readonly logout: { readonly Form: Route.Form<string> };
	}

	/** A revocable session with a fixed lifetime, from `c.session()`. */
	export type Session = ContextType.Session;

	/** A users table with a text `id`, which Auth creates accounts in. */
	export type Users = Table<string, any, any> & {
		readonly shape: {
			readonly id: Schema<string>;
			// passkey forms send these fields themselves
			readonly credential?: never;
			readonly ceremony?: never;
			readonly bootstrap?: never;
		};
	};

	/**
	 * Columns of a users table the server sets with defaults, such as a role.
	 *
	 * @template U Users table
	 */
	export type Defaulted<U extends Users> = U["options"] extends {
		readonly default: readonly (infer K)[];
	}
		? K
		: never;

	/**
	 * Columns of a users table Auth cannot fill when it creates a user, other
	 * than `id`, form fields, nullable columns, and columns with defaults.
	 *
	 * @template U Users table
	 */
	export type Unfilled<U extends Users> =
		U extends Table<string, infer S, infer O>
			? Exclude<
					Table.Key<S>,
					| "id"
					| Table.Defaulted<S, O>
					| { [K in keyof S]: S[K] extends Field.Any ? K : never }[keyof S]
				>
			: never;

	/**
	 * Registration fields of a users table, its form fields except `id` and
	 * columns with defaults.
	 *
	 * @template U Users table
	 */
	export type Fields<U extends Users> = {
		[
			K in keyof U["shape"] as K extends "id" | Defaulted<U>
				? never
				: U["shape"][K] extends Field.Any
					? K
					: never
		]: Extract<U["shape"][K], Field.Any>;
	};

	/** Auth's own endpoints, which its page cannot be */
	type Endpoint =
		| "/auth/register"
		| "/auth/login"
		| "/auth/logout"
		| "/auth/passkey"
		| "/auth/link"
		| "/auth/confirm"
		| "/_passkey/options/register"
		| "/_passkey/options/login"
		| "/_passkey/options/add"
		| "/_passkey/options/confirm"
		| "/_passkey/client.js";

	/**
	 * A page path, a path of the app's own that is not one of Auth's endpoints.
	 *
	 * @template P Page path
	 */
	export type Page<P extends string> = P extends Endpoint
		? "Auth's page cannot be one of its endpoints"
		: Route.Path<P>;

	/**
	 * Authentication configuration; all instances share the database.
	 *
	 * @template U Users table
	 * @template P Page path
	 * @template R Redirect path
	 * @template C Consent page path
	 */
	export interface Options<
		U extends Users = Users,
		P extends string = string,
		R extends string = string,
		C extends string = string,
	> {
		/** Signing secret(s), each at least 32 UTF-8 bytes. Seal with the first; accept all during rotation. */
		readonly secret: string | readonly [string, ...string[]];
		/** Trusted HTTPS origin, for example `https://example.com`. */
		readonly origin: string;
		/**
		 * Database containing `Auth.tables`, which stores challenges, sessions,
		 * credentials, and rate limits, and the users table.
		 */
		readonly database: Database &
			Database.Tables<typeof Auth.tables> &
			Database.Tables<readonly [U]>;
		/**
		 * Time in milliseconds a session lasts without being used; defaults to
		 * one week. Using it renews it, at most once a day.
		 */
		readonly idle?: number;
		/**
		 * Time in milliseconds from sign-in after which a session ends, however
		 * recently it was used; defaults to 30 days.
		 */
		readonly lifetime?: number;
		/**
		 * Users table in `database`. Its form fields, other than `id` and
		 * columns with defaults, are the registration form, and registering
		 * inserts the row in the transaction that stores the first passkey.
		 * Columns with defaults, such as a role, are set by the server, so a
		 * signup cannot choose them. Its other columns need defaults or must be nullable. The first
		 * field, such as an email, names the passkey.
		 */
		readonly users: U &
			([Unfilled<U>] extends [never]
				? unknown
				: `Give the users table's ${Unfilled<U>} column a default`);
		/** Authentication page, also used for generic failure redirects. Defaults to /login. */
		readonly page?: Page<P>;
		/** Destination after registration or login. Defaults to /. */
		readonly redirect?: Route.Path<R>;
		/**
		 * Page where users approve agents, which sign in when an MCP endpoint is
		 * given this `auth`. The page calls `auth.consent(c)` for the request and
		 * its form. Defaults to /connect.
		 */
		readonly consent?: Route.Path<C>;
	}

	/** An agent's request to act for the user, shown on the consent page. */
	export interface Consent {
		/** The agent asking */
		readonly client: {
			/**
			 * Client ID, the URL of the agent's metadata document. Its origin is
			 * who publishes the agent, show it on the page.
			 */
			readonly id: string;
			/** Name the agent gives itself, not verified */
			readonly name: string;
		};
		/** Host the user returns to after deciding, the agent's own */
		readonly returns: string;
		/** Form with Allow, confirmed with the user's passkey, and Deny buttons; custom `children` deny with `formaction="/oauth/deny"` */
		readonly Form: (props: JSX.IntrinsicElements["form"]) => JSX.Element;
	}

	/** One of a user's passkeys */
	export interface Passkey {
		/** Passkey's ID, which `remove` takes */
		readonly id: string;
		/** What the person called it when adding it, such as "Laptop" */
		readonly name: string | null;
		/** When it was made, in milliseconds */
		readonly created: number;
		/** Origin it was made at, the only one it signs in at */
		readonly origin: string;
		/** A password manager keeps a copy, so losing the device does not lose it */
		readonly synced: boolean;
	}

	/** An agent the user has connected */
	export interface Agent {
		/** Client ID, the URL of the agent's metadata document, which `disconnect` takes */
		readonly id: string;
		/** Name the agent gave itself when the user approved it, not verified */
		readonly name: string;
		/** When the user approved it, in milliseconds */
		readonly connected: number;
		/** When the connection ends and the user connects it again, in milliseconds */
		readonly expires: number;
	}

	export interface Credential {
		id: string;
		user: string;
		/** SPKI-encoded P-256 public key as base64url. */
		publicKey: string;
		counter: number;
		/** Whether the credential is eligible for backup; this must not change. */
		eligible: boolean;
		/** Current backup state, which may change. */
		backedUp: boolean;
		/** When it was made, in milliseconds. */
		created: number;
		/** Origin it was made at, the only one it signs in at. */
		origin: string;
		/** What the person called it when adding it, such as "Laptop". */
		name: string | null;
	}
}

/**
 * Complete passkey authentication stored in the application's Postgres database.
 *
 * @template U Users table, whose form fields are the registration form
 */
export class Auth<
	U extends Auth.Users = Auth.Users,
	P extends string = string,
	R extends string = string,
	C extends string = string,
> {
	/**
	 * Tables Auth stores its data in, include them in the database's tables.
	 * `database.migrate` then creates them, and `database.check` checks them.
	 */
	static readonly tables = [
		Storage.credentials,
		Storage.sessions,
		Storage.challenges,
		Limiter.table,
		Storage.tokens,
		Storage.links,
	] as const;

	readonly #options: State.Options;
	readonly #states = new WeakMap<object, State>();
	/** Auth's tables in its database */
	readonly #storage: Storage;
	/** The OAuth endpoints are mounted */
	readonly #mounted = new WeakSet<object>();

	/** Generated endpoints, mounted with `app.use(auth)`. */
	readonly #routes: readonly Route[];

	/** Authentication page, where a guard sends someone who is not signed in */
	readonly #page: string;
	/**
	 * Read an agent's authorization request on the consent page, with the form
	 * to allow or deny it. `null` when the request is invalid or expired.
	 */
	readonly consent: (c: Auth.Context) => Promise<Auth.Consent | null>;
	/** Signs agents in for an MCP endpoint given this `auth`, internal to ovr. */
	readonly [agents]: Mcp.Auth[typeof agents];
	/** Prepare request-scoped UI in the handler before returning JSX. */
	readonly forms: (
		c: Auth.Context,
		props?: { nonce?: string },
	) => Auth.Forms<Auth.Fields<U>>;

	/**
	 * Make a link that signs a user in once, for when they have no passkey
	 * where they need one: at another origin that shares the users table,
	 * such as production after registering on `localhost`, or after losing
	 * their device. It opens the authentication `page`, where `<link.Form />` from
	 * `auth.forms(c)` signs them in, and they add a passkey.
	 *
	 * Anyone who has the link is the user until it is used or expires, so
	 * make one only for a user your code has already identified, and send it
	 * the way you would a password. It is best kept to a script or an admin
	 * page, not a form any signed-in user can use in production.
	 *
	 * @param user ID of the user it signs in
	 * @param options The origin it is opened at, this one by default
	 * @returns The link, which lasts 5 minutes
	 */
	readonly link: (
		user: string,
		options?: { origin?: string },
	) => Promise<string>;

	/** Configure passkeys, session helpers, and automatic authentication rate limits. */
	constructor(options: Auth.Options<U, P, R, C>) {
		const origin = new URL(options.origin);
		if (origin.protocol !== "https:" || origin.origin !== options.origin)
			throw new TypeError("Auth origin must be an HTTPS origin without a path");
		// often from the environment, so its length is checked here
		if (
			[options.secret].flat().some((secret) => Codec.encode(secret).length < 32)
		)
			throw new TypeError("Auth secret must contain at least 32 bytes");
		// the users table Auth's tables reference in this database, for its check
		const chosen = references.get(options.database) ?? new Map();
		for (const table of Storage.owners) {
			const other = chosen.get(table);
			if (other && other !== options.users)
				throw new TypeError(
					`Auth's tables in this database already belong to the ${other.name} table`,
				);
			chosen.set(table, options.users);
		}
		references.set(options.database, chosen);
		const storage = Storage.of(options.database);
		this.#storage = storage;
		this.#options = {
			origin: options.origin,
			secret:
				typeof options.secret === "string"
					? options.secret
					: [options.secret[0], ...options.secret.slice(1)],
			...(options.idle === undefined ? {} : { idle: options.idle }),
			...(options.lifetime === undefined ? {} : { lifetime: options.lifetime }),
			challenges: storage.challenges,
			sessions: storage.sessions,
		};
		const service = configure(options, storage, (c) => this.#state(c));
		// resources tokens can be issued for, the MCP endpoints mounted with this auth
		const resources = new Set<string>();
		const signin = oauth(options, storage, (c) => this.#state(c), resources);
		this.#routes = service.routes;
		this.#page = options.page ?? "/login";
		this.forms = service.forms;
		this.link = service.link;
		this.consent = signin.consent;
		this[agents] = {
			origin: options.origin,
			bearer: signin.bearer,
			// the OAuth endpoints, once per app when several endpoints share them
			mount: (app, resource) => {
				if (!auths.has(app.fetch)) auths.set(app.fetch, this);
				resources.add(resource);
				if (this.#mounted.has(app.routes)) return [];

				if (!Metadata.supported)
					throw new TypeError(
						"Connecting agents requires Node.js or Bun to fetch client ID metadata documents safely",
					);

				// only once mounting succeeds, so a failed attempt is not skipped next time
				this.#mounted.add(app.routes);

				return this.#host(signin.routes);
			},
		};
	}

	/** Mounted by `app.use(auth)`, and lets every request read its session. */
	[mount](app: App.Mount): ReturnType<App.Service[typeof mount]> {
		if (!auths.has(app.fetch)) auths.set(app.fetch, this);

		return [
			(c: ContextType, next: () => Promise<void>) => {
				c[sessions] = () => this.#state(c).session();
				State.carried(c, this.#options.origin);
				return next();
			},
			this.#host(this.#routes),
		];
	}

	/**
	 * @param endpoints Generated endpoints
	 * @returns The endpoints, which reject alternate hosts before their handlers run
	 */
	#host(endpoints: readonly Route[]) {
		const routes = new Set<Route>(endpoints);

		return [
			(c: ContextType, next: () => Promise<void>) => {
				if (
					c.route &&
					routes.has(c.route) &&
					c.url.origin !== this.#options.origin
				) {
					noStore(c.res.headers);
					return c.text("Misdirected Request", 421);
				}
				return next();
			},
			...endpoints,
		];
	}

	/**
	 * @param c Request context, a component's or a handler's
	 * @returns Its session
	 */
	#session(c: View) {
		// a component's is the handler's own, typed without what answers
		return this.#state(c as unknown as State.Context).session();
	}

	#state(c: State.Context) {
		return this.#states.getOrInsertComputed(
			c,
			() => new State(c, this.#options),
		);
	}

	/** Establish a session for an already-authorized user with a non-blank ID of at most 1024 UTF-8 bytes. Built-in passkey handlers do this automatically. */
	readonly login = (
		c: Pick<Auth.Context, "url" | "cookie" | "res">,
		user: string,
	) => {
		return this.#state(c).login(user);
	};

	/**
	 * Middleware for a route that needs someone signed in. Anyone else is
	 * sent to the authentication `page`, and comes back once they sign in: to
	 * the page they asked for, or the page the form they sent was on. In the
	 * handler `c.session()` is never `null`.
	 *
	 * ```tsx
	 * Route.get("/recipes").use(auth.guard(() => <Book />));
	 *
	 * Route.post("/recipes").use(
	 * 	auth.guard(async (c) => {
	 * 		const { user } = await c.session();
	 * 	}),
	 * );
	 * ```
	 *
	 * @template P Parameters created from a route match
	 * @template S Parsed form data shape
	 * @param handler Middleware to run for a signed-in request
	 * @returns Middleware for the route
	 */
	readonly guard =
		<
			P extends Record<string, unknown> = Record<string, unknown>,
			S extends Field.Shape = any,
		>(
			handler: (
				c: {
					/** @returns The session, which the guard found */
					session(): Promise<ContextType.Session>;
				} & ContextType<P, S>,
				next: Middleware.Next,
			) => any,
		): Middleware<P, S> =>
		async (c, next) => {
			if (await this.#state(c).session()) return handler(c as never, next);

			// a page is asked for by its address, a form names the page it was on
			const read = c.req.method === "GET" || c.req.method === "HEAD";
			const back = read
				? c.url.pathname + c.url.search
				: c.url.searchParams.get("_return");

			return c.redirect(
				back ? `${this.#page}?_return=${encodeURIComponent(back)}` : this.#page,
				303,
			);
		};

	/** Revoke the current session and expire its cookie. Always await this method. */
	readonly logout = (c: Pick<Auth.Context, "url" | "cookie" | "res">) => {
		return this.#state(c).logout();
	};

	/**
	 * The signed-in user's passkeys, to list on an account page with a way to
	 * remove each.
	 *
	 * @param c Request context of the signed-in user
	 * @returns Each passkey, oldest first
	 * @throws When nobody is signed in
	 */
	readonly passkeys = async (c: View): Promise<Auth.Passkey[]> => {
		const session = await this.#session(c);
		if (!session) throw new Error("Sign in to list passkeys");

		return (await this.#storage.passkeys.list(session.user)).map((row) => ({
			id: row.id,
			name: row.name,
			created: row.created,
			origin: row.origin,
			synced: row.backedUp,
		}));
	};

	/**
	 * Remove one of the signed-in user's passkeys, such as one for a device
	 * they no longer have. Their last passkey is kept, since nothing else signs
	 * in as them.
	 *
	 * @param c Request context of the signed-in user
	 * @param id Passkey's ID, a passkey's `id` from `auth.passkeys(c)`
	 * @returns `true` when it was removed, `false` when it is their only
	 * passkey or not one of theirs
	 * @throws When nobody is signed in
	 */
	readonly remove = async (c: View, id: string) => {
		const session = await this.#session(c);
		if (!session) throw new Error("Sign in to remove a passkey");

		return this.#storage.passkeys.remove(session.user, id);
	};

	/**
	 * Connects an agent for a user without the consent page, as `Tester` does.
	 * It is listed and disconnected like any other.
	 *
	 * @param user ID of the user the agent acts for
	 * @param resource The MCP endpoint's URL, which the token is issued for
	 * @param agent The agent's client ID and the name it gives
	 * @returns An access token
	 */
	readonly [grant] = async (
		user: string,
		resource: string,
		agent: { id: string; name: string },
	) => {
		const access = Token.random();
		const now = Date.now();
		const row = {
			user,
			client: agent.id,
			name: agent.name,
			resource,
			scope: "",
		};

		await this.#storage.tokens.set(access, {
			...row,
			kind: "access",
			expiration: now + lifetime.access,
		});
		// what lists the agent as connected
		await this.#storage.tokens.set(Token.random(), {
			...row,
			kind: "refresh",
			expiration: now + lifetime.refresh,
		});

		return access;
	};

	/**
	 * The agents the signed-in user has connected, to list on an account page
	 * with a way to disconnect each.
	 *
	 * @param c Request context of the signed-in user
	 * @returns Each agent once, by its latest connection
	 * @throws When nobody is signed in
	 */
	readonly agents = async (c: View): Promise<Auth.Agent[]> => {
		const session = await this.#session(c);
		if (!session) throw new Error("Sign in to list agents");

		return (await this.#storage.tokens.agents(session.user)).map((row) => ({
			id: row.client,
			// one connected before names were kept
			name: row.name || new URL(row.client).host,
			// a connection lasts a fixed time from its approval
			connected: row.expiration - lifetime.refresh,
			expires: row.expiration,
		}));
	};

	/**
	 * Disconnect one of the signed-in user's agents. Once it resolves, the
	 * agent's codes and tokens no longer work, including ones a refresh was
	 * issuing meanwhile, and connecting again needs the user's consent.
	 *
	 * @param c Request context of the signed-in user
	 * @param client Agent's client ID, an agent's `id` from `auth.agents(c)`
	 * @throws When nobody is signed in
	 */
	readonly disconnect = async (c: View, client: string) => {
		const session = await this.#session(c);
		if (!session) throw new Error("Sign in to disconnect an agent");
		await this.#storage.tokens.revoke(session.user, client);
	};
}
