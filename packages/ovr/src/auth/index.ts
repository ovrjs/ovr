import type { Context as ContextType } from "../context/index.js";
import type { JSX } from "../jsx/index.js";
import type { Limiter } from "../limiter/index.js";
import type { Route } from "../route/index.js";
import type { Form } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { configure } from "./configure.js";
import { Issue } from "./issue.js";
import { State } from "./state.js";

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

	/** Server-side state for one WebAuthn ceremony. */
	export interface Challenge {
		readonly challenge: string;
		readonly browser: string;
		readonly method: "register" | "login";
		readonly action: string;
		readonly origin: string;
		readonly expiration: number;
		readonly user?: string;
	}

	/** Challenge storage shared by all application instances. */
	export interface Challenges {
		/** Store until expiration. Return false when shared storage capacity is exhausted. */
		set(id: string, challenge: Challenge): Result<void | boolean>;
		/** Atomically return and delete an entry; concurrent calls must have one winner. */
		take(id: string): Result<Challenge | null | undefined>;
	}

	/** A revocable session with a fixed lifetime. */
	export interface Session {
		/** Opaque session ID, usable with `auth.revoke()`. */
		readonly id: string;
		/** User ID. */
		readonly user: string;
		/** Absolute expiration time in milliseconds. */
		readonly expiration: number;
	}

	/** Session storage shared by all application instances. */
	export interface Sessions {
		/** Store a new session until its expiration. */
		set(id: string, session: Session): Result<void>;
		/** Return a session, or nothing if it has expired or been revoked. */
		get(id: string): Result<Session | null | undefined>;
		/** Revoke a session. */
		delete(id: string): Result<void>;
	}

	/** Database-backed authentication configuration; all instances must share persistence. */
	export interface Options<Shape extends Form.Shape = Form.Shape> {
		/** Random signing secret with at least 32 UTF-8 bytes. */
		readonly secret: string;
		/** Trusted HTTPS origin, for example `https://example.com`. */
		readonly origin: string;
		/** Required persistence for atomic, single-use challenges. */
		readonly challenges: Challenges;
		/** Required persistence for revocable sessions. */
		readonly sessions: Sessions;
		/** Session lifetime in milliseconds; defaults to one week, without sliding refresh. */
		readonly duration?: number;
		/** Credential lookup and atomic updates using the application's persistence. */
		readonly credentials: Auth.Credentials;
		/** Registration fields, provider labels, and atomic account creation. */
		readonly register: {
			/** Application fields, validated before prompting and again before saving. */
			readonly fields: Shape;
			/** Human-readable account label, independent of the opaque user handle. */
			readonly name: (data: Form.Parse.Data<Shape>) => Result<string>;
			/** Atomically insert a new user and credential, enforcing unique user and credential IDs. Never upsert an existing user. */
			readonly create: (
				data: Form.Parse.Data<Shape>,
				credential: Auth.Credential,
			) => Result<void>;
		};
		/** Authentication page, also used for generic failure redirects. Defaults to /auth. */
		readonly page?: string;
		/** Destination after registration or login. Defaults to /. */
		readonly redirect?: string;
		/** Override the default endpoint paths. Paths must be distinct literal local paths. */
		readonly paths?: Partial<Record<"register" | "login" | "logout", string>>;
		/** Shared rate-limit storage; ovr supplies the signup and sign-in policies. */
		readonly limits: {
			/** Atomically refill and consume a token across all workers and deployments sharing these policies. */
			readonly consume: Limiter.Options["consume"];
			/** Optional generous request ceiling before client key creation. Counts requests denied by later policies too. */
			readonly guard?: Limiter;
			/** Additional shared policies checked after the client policy, preserving the built-in defaults. */
			readonly extra?: readonly Limiter[];
			/** Replace the built-in registration client policy. Use extra to add shared policies without removing it. */
			readonly register?: Limiter;
			/** Replace the built-in login client policy. Use extra to add shared policies without removing it. */
			readonly login?: Limiter;
		};
		/** Receive detailed failures for server-side logging. Details are never sent to the browser. */
		readonly error?: (
			error: unknown,
			c: Pick<ContextType, "req" | "url" | "cookie" | "ip">,
		) => Result<void>;
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

	/** Application-owned credential lookup and persistence. */
	export interface Credentials {
		get(id: string): Result<Credential | null | undefined>;
		/**
		 * Atomically save `credential` only if the record still matches `previous`.
		 * Return true when the snapshot matches, even when the values are unchanged.
		 * Use matched rows (or RETURNING), not changed-row counts. Return false for a
		 * concurrent change or deletion; never recreate a deleted passkey.
		 */
		update(credential: Credential, previous: Credential): Result<boolean>;
	}
}

/** Complete passkey authentication with application-owned persistence. */
export class Auth<Shape extends Form.Shape = Form.Shape> {
	/** Validation issue shared by authentication and passkey verification. */
	static readonly Issue = Issue;

	readonly #options;
	readonly #states = new WeakMap<object, State>();

	/** Generated endpoints; App mounts them automatically. */
	readonly routes: readonly Route[];
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
		if (Codec.encode(options.secret).length < 32)
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
		this.#options = { ...options };
		const service = configure(this.#options, (c) => this.#state(c));
		this.routes = service.routes;
		this.forms = service.forms;
	}

	/** Canonical HTTPS origin used by this service. */
	get origin() {
		return this.#options.origin;
	}

	#state(c: State.Context) {
		let state = this.#states.get(c);
		if (!state) {
			state = new State(c, this.#options);
			this.#states.set(c, state);
		}
		return state;
	}

	/** Read a session in the handler before returning streamed JSX. Does not extend its lifetime. */
	session(c: Pick<Auth.Context, "url" | "cookie" | "res">) {
		return this.#state(c).session();
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
