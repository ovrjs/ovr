import { type App, agents, mount } from "../app/index.js";
import { type Context as ContextType, sessions } from "../context/index.js";
import type { Database } from "../database/index.js";
import type { JSX } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import type { Route } from "../route/index.js";
import type { Field, Form, Schema } from "../schema/index.js";
import type { Table } from "../table/index.js";
import { Codec, Time } from "../util/index.js";
import { configure } from "./configure.js";
import { Issue } from "./issue.js";
import { Metadata } from "./metadata.js";
import { oauth } from "./oauth.js";
import { State } from "./state.js";
import { Storage } from "./storage.js";

export namespace Auth {
	/** Authentication validation issue. */
	export type Issue = InstanceType<typeof Auth.Issue>;

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

	/** Rate limit policy, Auth creates the `Limiter` with its database. */
	export type Limit = Omit<Limiter.Options, "database">;

	/** A revocable session with a fixed lifetime, from `c.session()`. */
	export type Session = ContextType.Session;

	/** A users table with a text `id`, which Auth creates accounts in. */
	export type Users = Table<string, any, any> & {
		readonly shape: { readonly id: Schema<string> };
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
		/** Database containing `Auth.tables`, which stores challenges, sessions, credentials, and rate limits. */
		readonly database: Database;
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
		/** Change the built-in signup and sign-in rate limits, stored in `database`. */
		readonly limits?: {
			/** Change the built-in registration client policy, 5 per 10 minutes; invalid options fields do not consume it. */
			readonly register?: Auth.Limit;
			/** Change the built-in login client policy, 20 per minute. */
			readonly login?: Auth.Limit;
		};
	}

	/** An agent's request to act for the user, shown on the consent page. */
	export interface Consent {
		/** The agent, as it names itself */
		readonly client: {
			/** Name the agent registered, not verified */
			readonly name: string;
			/** Client ID metadata document URL, for agents that have one */
			readonly uri?: string;
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
	/** Validation issue shared by authentication and passkey verification. */
	static readonly Issue = Issue;

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
	/** OAuth endpoints for agents */
	readonly #oauth: readonly Route[];
	/** The OAuth endpoints are mounted */
	readonly #mounted = new WeakSet<object>();

	/** Generated endpoints, mounted with `app.use(auth)`. */
	readonly routes: readonly Route[];
	/**
	 * Read an agent's authorization request on the consent page, with the form
	 * to allow or deny it. `null` when the request is invalid or expired.
	 */
	readonly consent: (c: Auth.Context) => Promise<Auth.Consent | null>;
	/**
	 * Read the session of an agent's bearer token issued for `resource`, such
	 * as the MCP endpoint URL.
	 */
	readonly bearer: (
		c: Pick<ContextType, "req">,
		resource: string,
	) => Promise<Auth.Session | null>;
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
		if (
			!secrets.length ||
			secrets.some(
				(secret) =>
					typeof secret !== "string" || Codec.encode(secret).length < 32,
			)
		)
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
		if (typeof options.database?.sql !== "function")
			throw new TypeError("Auth requires a database");
		if (
			Auth.tables.some(
				(table) => Reflect.get(options.database, table.name) !== table,
			)
		)
			throw new TypeError(
				"Auth's tables are missing from the database, add ...Auth.tables to its tables",
			);
		if (Reflect.get(options.database, options.users?.name) !== options.users)
			throw new TypeError(
				"Auth's users table is missing from the database, add it to its tables",
			);
		const storage = Storage.of(options.database);
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
		const signin = oauth(options, storage, (c) => this.#state(c));
		this.routes = service.routes;
		this.#oauth = signin.routes;
		this.forms = service.forms;
		this.consent = signin.consent;
		this.bearer = signin.bearer;
	}

	/** Mounted by `app.use(auth)`, and lets every request read its session. */
	[mount](): ReturnType<App.Service[typeof mount]> {
		return [
			(c: ContextType, next: () => Promise<void>) => {
				c[sessions] = () => this.#state(c).session();
				return next();
			},
			this.#host(this.routes),
		];
	}

	/**
	 * Mounted by an MCP endpoint given this `auth`, the OAuth endpoints agents
	 * sign in with. Once per app, when several endpoints share it.
	 *
	 * @param app App the endpoint is mounted on
	 */
	[agents](app: App.Mount): ReturnType<App.Service[typeof mount]> {
		if (this.#mounted.has(app.routes)) return [];

		if (!Metadata.supported)
			throw new TypeError(
				"Connecting agents requires Node.js or Bun to fetch client ID metadata documents safely",
			);

		// only once mounting succeeds, so a failed attempt is not skipped next time
		this.#mounted.add(app.routes);

		return this.#host(this.#oauth);
	}

	/**
	 * @param endpoints Generated endpoints
	 * @returns The endpoints, which reject alternate hosts before their handlers run
	 */
	#host(endpoints: readonly Route[]) {
		const routes = new Set<Route>(endpoints);

		return [
			(c: ContextType, next: () => Promise<void>) => {
				if (c.route && routes.has(c.route) && c.url.origin !== this.origin) {
					c.res.headers.set("cache-control", "no-store");
					return c.text("Misdirected Request", 421);
				}
				return next();
			},
			...endpoints,
		];
	}

	/** Canonical HTTPS origin used by this service. */
	get origin() {
		return this.#options.origin;
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
}
