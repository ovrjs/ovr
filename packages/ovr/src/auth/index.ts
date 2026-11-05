import { type App, agents, mount } from "../app/index.js";
import { type Context as ContextType, sessions } from "../context/index.js";
import { type Database, references } from "../database/index.js";
import type { JSX } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import type { Mcp } from "../mcp/index.js";
import type { Route } from "../route/index.js";
import type { Field, Form, Schema } from "../schema/index.js";
import type { Table } from "../table/index.js";
import { Codec, Time } from "../util/index.js";
import { configure } from "./configure.js";
import { Metadata } from "./metadata.js";
import { oauth } from "./oauth.js";
import { State } from "./state.js";
import { Storage } from "./storage.js";

export namespace Auth {
	/** Authentication validation issue. */

	/** Request capabilities required while preparing the built-in UI. */
	export type Context = Pick<ContextType, "url" | "cookie" | "res" | "form"> & {
		data: (options?: { payload: number }) => Promise<unknown>;
	};
	/** Request-scoped UI pieces with application field names preserved. */
	export interface Forms<Shape extends Form.Shape> {
		Register: Route.Form<string> & {
			Field: Form<Shape>["Field"];
			Fields: Form<Shape>["Fields"];
			Error: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		Login: Route.Form<string> & {
			Error: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		Logout: Route.Form<string>;
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

	/** Columns of a users table the server sets with defaults, such as a role. */
	export type Defaulted<U extends Users> = U["options"] extends {
		readonly default: readonly (infer K)[];
	}
		? K
		: never;

	/**
	 * Registration fields of a users table, its form fields except `id` and
	 * columns with defaults.
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

	/** Authentication configuration; all instances share the database. */
	export interface Options<U extends Users = Users> {
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
		 * signup cannot choose them. Its other columns need defaults. The first
		 * field, such as an email, names the passkey.
		 */
		readonly users: U;
		/** Authentication page, also used for generic failure redirects. Defaults to /login. */
		readonly page?: string;
		/** Destination after registration or login. Defaults to /. */
		readonly redirect?: string;
		/**
		 * Page where users approve agents, which sign in when an MCP endpoint is
		 * given this `auth`. The page calls `auth.consent(c)` for the request and
		 * its form. Defaults to /connect.
		 */
		readonly consent?: string;
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
		/** Host the user returns to after deciding */
		readonly redirect: string;
		/** Form with Allow, confirmed with the user's passkey, and Deny buttons; custom `children` deny with `formaction="/oauth/deny"` */
		readonly Form: (props: JSX.IntrinsicElements["form"]) => JSX.Element;
	}

	/** Stored ES256 passkey, including state updated after each login. */
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
	}
}

/** Complete passkey authentication stored in the application's Postgres database. */
export class Auth<U extends Auth.Users = Auth.Users> {
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
	] as const;

	readonly #options: State.Options;
	readonly #states = new WeakMap<object, State>();
	/** Auth's tables in its database */
	readonly #storage: Storage;
	/** The OAuth endpoints are mounted */
	readonly #mounted = new WeakSet<object>();

	/** Generated endpoints, mounted with `app.use(auth)`. */
	readonly #routes: readonly Route[];
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

	/** Configure passkeys, session helpers, and automatic authentication rate limits. */
	constructor(options: Auth.Options<U>) {
		const origin = new URL(options.origin);
		if (origin.protocol !== "https:" || origin.origin !== options.origin)
			throw new TypeError("Auth origin must be an HTTPS origin without a path");
		const secrets =
			typeof options.secret === "string"
				? [options.secret]
				: [...options.secret];
		// often from the environment, so its length is checked here
		if (secrets.some((secret) => Codec.encode(secret).length < 32))
			throw new TypeError("Auth secret must contain at least 32 bytes");
		for (const name of ["idle", "lifetime"] as const) {
			const value = options[name];
			if (
				value !== undefined &&
				(!Number.isSafeInteger(value) ||
					value < Time.second ||
					value > 365 * Time.day)
			)
				throw new TypeError(
					`Auth ${name} must be a time in milliseconds, from one second to a year`,
				);
		}
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
		this.forms = service.forms;
		this.consent = signin.consent;
		this[agents] = {
			origin: options.origin,
			bearer: signin.bearer,
			// the OAuth endpoints, once per app when several endpoints share them
			mount: (app, resource) => {
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
	[mount](): ReturnType<App.Service[typeof mount]> {
		return [
			(c: ContextType, next: () => Promise<void>) => {
				c[sessions] = () => this.#state(c).session();
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
					c.res.headers.set("cache-control", "no-store");
					return c.text("Misdirected Request", 421);
				}
				return next();
			},
			...endpoints,
		];
	}

	#state(c: State.Context) {
		return this.#states.getOrInsertComputed(
			c,
			() => new State(c, this.#options),
		);
	}

	/** Establish a session for an already-authorized user with a non-blank ID of at most 1024 UTF-8 bytes. Built-in passkey handlers do this automatically. */
	login(c: Pick<Auth.Context, "url" | "cookie" | "res">, user: string) {
		return this.#state(c).login(user);
	}

	/** Revoke the current session and expire its cookie. Always await this method. */
	logout(c: Pick<Auth.Context, "url" | "cookie" | "res">) {
		return this.#state(c).logout();
	}

	/**
	 * Disconnect one of the signed-in user's agents. Once it resolves, the
	 * agent's codes and tokens no longer work, including ones a refresh was
	 * issuing meanwhile, and connecting again needs the user's consent.
	 *
	 * @param c Request context of the signed-in user
	 * @param client Agent's client ID, from `auth_tokens`
	 * @throws When nobody is signed in
	 */
	async disconnect(
		c: Pick<Auth.Context, "url" | "cookie" | "res">,
		client: string,
	) {
		const session = await this.#state(c).session();
		if (!session) throw new Error("Sign in to disconnect an agent");
		await this.#storage.tokens.revoke(session.user, client);
	}
}
