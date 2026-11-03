import { type App, mount } from "../app/index.js";
import { type Context as ContextType, Halt } from "../context/index.js";
import type { Database } from "../database/index.js";
import type { JSX } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import type { Route } from "../route/index.js";
import type { Form } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { configure } from "./configure.js";
import { Issue } from "./issue.js";
import { oauth } from "./oauth.js";
import { State } from "./state.js";
import { Storage } from "./storage.js";

type Result<T> = T | Promise<T>;

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
	export type Limit = Omit<Limiter.Options, "database" | "error">;

	/** A revocable session with a fixed lifetime. */
	export interface Session {
		/** Opaque session ID, usable with `auth.revoke()`. */
		readonly id: string;
		/** User ID. */
		readonly user: string;
		/** Absolute expiration time in milliseconds. */
		readonly expiration: number;
	}

	/** Authentication configuration; all instances share the database. */
	export interface Options<Shape extends Form.Shape = Form.Shape> {
		/** Signing secret(s), each at least 32 UTF-8 bytes. Seal with the first; accept all during rotation. */
		readonly secret: string | readonly [string, ...string[]];
		/** Trusted HTTPS origin, for example `https://example.com`. */
		readonly origin: string;
		/** Database containing `Auth.tables`, which stores challenges, sessions, credentials, and rate limits. */
		readonly database: Database;
		/** Session lifetime in milliseconds; defaults to one week, without sliding refresh. */
		readonly duration?: number;
		/** Registration fields, provider labels, and account creation. */
		readonly register: {
			/** Application fields, validated before prompting and again before saving. */
			readonly fields: Shape;
			/** Human-readable account label, independent of the opaque user handle. */
			readonly name: (data: Form.Parse.Data<Shape>) => Result<string>;
			/** Insert the account with `t`, in the transaction that stores its first credential. Never upsert an existing user. */
			readonly create: (
				t: Database.Transaction,
				data: Form.Parse.Data<Shape>,
				user: string,
			) => Result<void>;
		};
		/** Authentication page, also used for generic failure redirects. Defaults to /login. */
		readonly page?: string;
		/** Destination after registration or login. Defaults to /. */
		readonly redirect?: string;
		/**
		 * Page where users approve agents that connect through MCP, such as
		 * `/connect`. Setting it enables OAuth for agents. The page calls
		 * `auth.consent(c)` for the request and its form.
		 */
		readonly consent?: string;
		/** Override the default endpoint paths. Paths must be distinct literal local paths. */
		readonly paths?: Partial<Record<"register" | "login" | "logout", string>>;
		/** Additional and changed rate limits, stored in `database`; ovr supplies the signup and sign-in policies. */
		readonly limits?: {
			/** Optional generous request ceiling before client key creation. Counts invalid fields and requests denied by later policies too. */
			readonly guard?: Auth.Limit;
			/** Additional shared policies checked after the client policy, preserving the built-in defaults. */
			readonly extra?: readonly Auth.Limit[];
			/** Change the built-in registration client policy, 5 per 10 minutes; invalid options fields do not consume it. */
			readonly register?: Auth.Limit;
			/** Change the built-in login client policy, 20 per minute. */
			readonly login?: Auth.Limit;
		};
		/** Receive detailed failures for server-side logging. Details are never sent to the browser. */
		readonly error?: (
			error: unknown,
			c: Pick<ContextType, "req" | "url" | "cookie" | "ip">,
		) => Result<void>;
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
		/** Form with Allow and Deny buttons, or custom `children` buttons named `decision` */
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
export class Auth<Shape extends Form.Shape = Form.Shape> {
	/** Validation issue shared by authentication and passkey verification. */
	static readonly Issue = Issue;

	/**
	 * Migration SQL creating `Auth.tables`, by version. A version never
	 * changes, so its checksum stays valid; later changes ship as new versions.
	 * User IDs are text, so they hold any ID `auth.login` accepts.
	 *
	 * ```ts
	 * await db.migrate([
	 * 	{ id: "0002_auth", sql: Auth.sql[1] },
	 * 	{ id: "0003_auth_agents", sql: Auth.sql[2] },
	 * ]);
	 * ```
	 */
	static readonly sql = {
		1: `CREATE TABLE ovr_credentials (
	id text PRIMARY KEY,
	"user" text NOT NULL,
	"publicKey" text NOT NULL,
	counter bigint NOT NULL,
	eligible boolean NOT NULL,
	"backedUp" boolean NOT NULL
);
CREATE INDEX ovr_credentials_user ON ovr_credentials ("user");

CREATE TABLE ovr_sessions (
	id text PRIMARY KEY,
	"user" text NOT NULL,
	expiration bigint NOT NULL
);
CREATE INDEX ovr_sessions_user ON ovr_sessions ("user");
CREATE INDEX ovr_sessions_expiration ON ovr_sessions (expiration);

CREATE TABLE ovr_challenges (
	id text PRIMARY KEY,
	challenge text NOT NULL,
	browser text NOT NULL,
	method text NOT NULL,
	action text NOT NULL,
	origin text NOT NULL,
	expiration bigint NOT NULL,
	"user" text,
	fields text
);
CREATE INDEX ovr_challenges_expiration ON ovr_challenges (expiration);
CREATE INDEX ovr_challenges_browser ON ovr_challenges (browser, expiration);

${Limiter.sql[1]}`,
		2: `CREATE TABLE ovr_tokens (
	id text PRIMARY KEY,
	kind text NOT NULL,
	"user" text NOT NULL,
	client text NOT NULL,
	resource text NOT NULL,
	scope text NOT NULL,
	redirect text,
	challenge text,
	family text NOT NULL,
	expiration bigint NOT NULL
);
CREATE INDEX ovr_tokens_family ON ovr_tokens (family);
CREATE INDEX ovr_tokens_user ON ovr_tokens ("user");
CREATE INDEX ovr_tokens_expiration ON ovr_tokens (expiration);`,
	} as const;

	/** Tables Auth stores its data in, include them in the database's tables. */
	static readonly tables = [
		Storage.credentials,
		Storage.sessions,
		Storage.challenges,
		Limiter.table,
		Storage.tokens,
	] as const;

	readonly #options: State.Options;
	readonly #page: string;
	readonly #states = new WeakMap<object, State>();

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
	) => Auth.Forms<Shape>;

	/** Configure passkeys, session helpers, and automatic authentication rate limits. */
	constructor(options: Auth.Options<Shape>) {
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
		if (
			options.duration !== undefined &&
			(!Number.isSafeInteger(options.duration) ||
				options.duration < Time.second ||
				options.duration > 365 * Time.day)
		)
			throw new TypeError(
				"Auth duration must be a positive lifetime in milliseconds",
			);
		if (typeof options.database?.transaction !== "function")
			throw new TypeError("Auth requires a database");
		const storage = Storage.of(options.database);
		this.#options = {
			origin: options.origin,
			secret:
				typeof options.secret === "string"
					? options.secret
					: [options.secret[0], ...options.secret.slice(1)],
			...(options.duration === undefined ? {} : { duration: options.duration }),
			challenges: storage.challenges,
			sessions: storage.sessions,
		};
		this.#page = options.page ?? "/login";
		const service = configure(options, storage, (c) => this.#state(c));
		const agents = oauth(options, storage, (c) => this.#state(c));
		this.routes = [...service.routes, ...agents.routes];
		this.forms = service.forms;
		this.consent = agents.consent;
		this.bearer = agents.bearer;
	}

	/**
	 * Mounted by `app.use(auth)`. Generated endpoints reject alternate hosts
	 * before their handlers run.
	 */
	[mount](): ReturnType<App.Service[typeof mount]> {
		const routes = new Set<Route>(this.routes);

		return [
			(c: ContextType, next: () => Promise<void>) => {
				if (c.route && routes.has(c.route) && c.url.origin !== this.origin) {
					c.res.headers.set("cache-control", "no-store");
					return c.text("Misdirected Request", 421);
				}
				return next();
			},
			...this.routes,
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

	/** Read a session in the handler before returning streamed JSX. Does not extend its lifetime. */
	session(c: Pick<Auth.Context, "url" | "cookie" | "res">) {
		return this.#state(c).session();
	}

	/**
	 * Read the session of a protected page, or redirect to the authentication
	 * page and end the request. Call it in the handler before returning JSX.
	 *
	 * ```ts
	 * const session = await auth.require(c);
	 * ```
	 */
	async require(
		c: Pick<ContextType, "url" | "cookie" | "res" | "redirect">,
	): Promise<Auth.Session> {
		const session = await this.session(c);

		if (session) return session;

		c.redirect(this.#page, 303);
		throw new Halt("Authentication required");
	}

	/** Establish a session for an already-authorized user with a non-blank ID of at most 1024 UTF-8 bytes. Built-in passkey handlers do this automatically. */
	login(c: Pick<Auth.Context, "url" | "cookie" | "res">, user: string) {
		return this.#state(c).login(user);
	}

	/** Revoke the current session and expire its cookie. Always await this method. */
	logout(c: Pick<Auth.Context, "url" | "cookie" | "res">) {
		return this.#state(c).logout();
	}

	/** Revoke a selected session, also clearing this request's cookie when it matches. */
	revoke(c: Pick<Auth.Context, "url" | "cookie" | "res">, id: string) {
		return this.#state(c).revoke(id);
	}
}
